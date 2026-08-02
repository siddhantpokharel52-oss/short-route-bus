"""
Idempotency-key tests for POST /public-api/v1/tickets/.

Exercises the FastAPI app directly, mocking tenant_db's DB access, the
Django HTTP proxy call, and Redis (via FastAPI's own dependency_overrides
for get_redis — the same dependency gps/router.py and live_ops/router.py
already use, just substituted with an in-memory stand-in for the test). No
live Postgres/Redis/Django is required to run these.

Two request-timing shapes are tested separately and labeled accordingly:
  * SEQUENTIAL — one full request-response cycle completes before the next
    starts. This does NOT exercise the check-then-act race a naive
    GET-then-SET implementation has, because there's never two requests
    both mid-flight at once.
  * CONCURRENT — two requests genuinely in flight at the same time, via
    asyncio.gather() against an async client. This is the one that actually
    exercises the SET-NX reservation; a sequential-only test would still
    pass even with the race condition present.
"""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt

from backend.fastapi_services.config import settings as fastapi_settings
from backend.fastapi_services.dependencies import get_redis
from backend.fastapi_services.main import app
from backend.fastapi_services.public_api import router as public_api_router

JWT_SECRET = fastapi_settings.JWT_SECRET_KEY
JWT_ALG = fastapi_settings.JWT_ALGORITHM

TICKET_RESPONSE = {
    "success": True,
    "data": {"id": "tkt-1", "ticket_uid": "TKT-XYZ999", "status": "VALID"},
    "message": "Ticket issued successfully.",
    "errors": None,
}


class FakeDjangoResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeRedis:
    """In-memory stand-in for redis.asyncio.Redis, including NX semantics
    (an asyncio.Lock guards the check-and-set, matching how a real
    single-threaded Redis server serializes SET NX against concurrent
    callers) — without this, the concurrency test below wouldn't actually
    prove anything about the reservation being atomic."""

    def __init__(self):
        self.store: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ex=None, nx=False):
        async with self._lock:
            if nx and key in self.store:
                return None
            self.store[key] = value
            return True

    async def delete(self, key):
        self.store.pop(key, None)


class BrokenRedis:
    """Simulates Redis being unreachable — every call raises."""

    async def get(self, key):
        raise ConnectionError("redis down")

    async def set(self, key, value, ex=None, nx=False):
        raise ConnectionError("redis down")

    async def delete(self, key):
        raise ConnectionError("redis down")


def _conductor_token(schema):
    return jose_jwt.encode(
        {"user_id": "conductor-1", "role": "CONDUCTOR", "tenant_schema": schema}, JWT_SECRET, algorithm=JWT_ALG
    )


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def fake_redis():
    fr = FakeRedis()
    app.dependency_overrides[get_redis] = lambda: fr
    yield fr
    app.dependency_overrides.pop(get_redis, None)


def _issue(client, schema, payload):
    return client.post(
        "/public-api/v1/tickets/",
        json=payload,
        headers={"Authorization": f"Bearer {_conductor_token(schema)}"},
    )


# ─────────────────────────────────────────────────────────────────────────────
# SEQUENTIAL duplicate key — would pass even with the check-then-act race
# present, since the two calls never overlap. Kept as a distinct case from
# the concurrent test below, not a substitute for it.
# ─────────────────────────────────────────────────────────────────────────────

def test_sequential_duplicate_idempotency_key_issues_only_one_ticket(client, fake_redis):
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router, "_proxy_to_django", new=AsyncMock(return_value=FakeDjangoResponse(201, TICKET_RESPONSE))
    ) as mock_proxy:
        payload = {"route_id": "r1", "idempotency_key": "device-abc-123"}
        resp1 = _issue(client, "tenant_a", payload)
        resp2 = _issue(client, "tenant_a", payload)

    assert resp1.status_code == 201, resp1.text
    assert resp2.status_code == 201, resp2.text
    assert resp1.json() == TICKET_RESPONSE
    assert resp2.json() == TICKET_RESPONSE  # second call returns the first ticket's data unchanged
    mock_proxy.assert_awaited_once()  # only one Django call was made — only one ticket created


# ─────────────────────────────────────────────────────────────────────────────
# CONCURRENT duplicate key — two requests genuinely in flight at once via
# asyncio.gather(). This is the one that actually exercises the SET-NX
# reservation: _proxy_to_django is made deliberately slow so both requests
# are guaranteed to be mid-flight simultaneously, the way it would happen
# with a real near-simultaneous payment-callback retry.
# ─────────────────────────────────────────────────────────────────────────────

def test_concurrent_duplicate_idempotency_key_proxies_exactly_once(fake_redis):
    call_count = 0

    async def slow_proxy(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)  # long enough to guarantee both requests overlap
        return FakeDjangoResponse(201, TICKET_RESPONSE)

    async def _run():
        with patch.object(
            public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
        ), patch.object(public_api_router, "_proxy_to_django", new=slow_proxy):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                payload = {"route_id": "r1", "idempotency_key": "concurrent-key-1"}
                headers = {"Authorization": f"Bearer {_conductor_token('tenant_a')}"}
                return await asyncio.gather(
                    ac.post("/public-api/v1/tickets/", json=payload, headers=headers),
                    ac.post("/public-api/v1/tickets/", json=payload, headers=headers),
                )

    resp1, resp2 = asyncio.run(_run())

    assert call_count == 1, f"_proxy_to_django was called {call_count} times — a ticket was double-booked"
    # One of the two responses is the winner's real result; the other is either that same
    # result (fetched by polling) or the 409 "already in progress" if the 3s poll window
    # elapsed before the (artificially slow) winner finished — either way, never a second ticket.
    statuses = {resp1.status_code, resp2.status_code}
    assert statuses <= {201, 409}
    assert 201 in statuses
    for r in (resp1, resp2):
        if r.status_code == 201:
            assert r.json() == TICKET_RESPONSE


def test_idempotency_key_stripped_before_forwarding_to_django(client, fake_redis):
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router, "_proxy_to_django", new=AsyncMock(return_value=FakeDjangoResponse(201, TICKET_RESPONSE))
    ) as mock_proxy:
        _issue(client, "tenant_a", {"route_id": "r1", "idempotency_key": "device-abc-123"})

    sent_body = mock_proxy.await_args.kwargs["json_body"]
    assert "idempotency_key" not in sent_body
    assert sent_body["route_id"] == "r1"


def test_idempotency_key_is_scoped_per_tenant(client, fake_redis):
    """Two different operators reusing the same key value must not dedupe against each other —
    the cache key is (tenant_schema, idempotency_key), not idempotency_key alone."""
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="x.kvbms.com.np")
    ), patch.object(
        public_api_router, "_proxy_to_django", new=AsyncMock(return_value=FakeDjangoResponse(201, TICKET_RESPONSE))
    ) as mock_proxy:
        payload = {"route_id": "r1", "idempotency_key": "same-key"}
        _issue(client, "tenant_a", payload)
        _issue(client, "tenant_b", payload)

    assert mock_proxy.await_count == 2  # different tenants — not deduped against each other


def test_missing_idempotency_key_is_a_documented_soft_gap(client, fake_redis):
    """No key means no dedupe protection — existing callers that don't send one keep
    today's exact behavior (one Django call per request), by design."""
    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(
        public_api_router, "_proxy_to_django", new=AsyncMock(return_value=FakeDjangoResponse(201, TICKET_RESPONSE))
    ) as mock_proxy:
        _issue(client, "tenant_a", {"route_id": "r1"})
        _issue(client, "tenant_a", {"route_id": "r1"})

    assert mock_proxy.await_count == 2


# ─────────────────────────────────────────────────────────────────────────────
# Redis unavailable — ticket issuance must degrade gracefully, not hard-fail.
# Covers both a keyed request (this is the one that was actually broken
# before the fix — see the review note above issue_ticket) and a non-keyed
# request (already safe before the fix, purely because redis.get/set were
# never reached in that path — tested here to lock that guarantee in).
# ─────────────────────────────────────────────────────────────────────────────

def test_redis_unavailable_with_idempotency_key_still_issues_ticket(client):
    app.dependency_overrides[get_redis] = lambda: BrokenRedis()
    try:
        with patch.object(
            public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
        ), patch.object(
            public_api_router,
            "_proxy_to_django",
            new=AsyncMock(return_value=FakeDjangoResponse(201, TICKET_RESPONSE)),
        ) as mock_proxy:
            resp = _issue(client, "tenant_a", {"route_id": "r1", "idempotency_key": "k1"})
    finally:
        app.dependency_overrides.pop(get_redis, None)

    assert resp.status_code == 201, resp.text
    assert resp.json() == TICKET_RESPONSE
    mock_proxy.assert_awaited_once()


# ─────────────────────────────────────────────────────────────────────────────
# A failed (non-2xx) attempt must never get cached as "the result" — caught by
# a real end-to-end smoke test against live Django: a malformed forwarded
# token produced a 401, that 401 got cached under the idempotency_key with
# the full 24h TTL, and every subsequent retry with the same key — including
# ones with a perfectly valid token — kept replaying the stale 401 instead of
# actually retrying. FakeRedis's NX semantics alone wouldn't have caught this
# (it was never about the reservation being non-atomic); this specifically
# checks what gets written once a result comes back.
# ─────────────────────────────────────────────────────────────────────────────

def test_failed_attempt_is_not_cached_and_retry_actually_retries(client, fake_redis):
    responses = [
        FakeDjangoResponse(401, {"success": False, "data": None, "message": "Authentication required.", "errors": None}),
        FakeDjangoResponse(201, TICKET_RESPONSE),
    ]

    async def flaky_proxy(*args, **kwargs):
        return responses.pop(0)

    with patch.object(
        public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
    ), patch.object(public_api_router, "_proxy_to_django", new=flaky_proxy):
        payload = {"route_id": "r1", "idempotency_key": "retry-after-failure"}
        resp1 = _issue(client, "tenant_a", payload)
        resp2 = _issue(client, "tenant_a", payload)

    assert resp1.status_code == 401, resp1.text
    # The retry must actually reach Django again (responses list fully consumed,
    # so a second call landing here proves it wasn't served from a stale cache
    # entry) and get the real, successful result — not the first call's failure.
    assert resp2.status_code == 201, resp2.text
    assert resp2.json() == TICKET_RESPONSE
    assert responses == []  # both queued responses were consumed — two real proxy calls happened


def test_redis_unavailable_without_idempotency_key_still_issues_ticket(client):
    app.dependency_overrides[get_redis] = lambda: BrokenRedis()
    try:
        with patch.object(
            public_api_router.tenant_db, "get_domain_for_schema", new=AsyncMock(return_value="tenant-a.kvbms.com.np")
        ), patch.object(
            public_api_router,
            "_proxy_to_django",
            new=AsyncMock(return_value=FakeDjangoResponse(201, TICKET_RESPONSE)),
        ) as mock_proxy:
            resp = _issue(client, "tenant_a", {"route_id": "r1"})
    finally:
        app.dependency_overrides.pop(get_redis, None)

    assert resp.status_code == 201, resp.text
    assert resp.json() == TICKET_RESPONSE
    mock_proxy.assert_awaited_once()
