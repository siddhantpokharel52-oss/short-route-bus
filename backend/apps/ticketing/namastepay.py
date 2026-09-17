"""NamastePay hosted-checkout client (Checkout v2). Every tenant hits the
same base URLs and request/response shapes; only the credentials differ,
so this is plain functions taking a NamastePayConfig rather than a
per-tenant class hierarchy -- there's only one gateway to support right
now (mirrors how this codebase keeps single-partner integrations concrete
instead of building a generalized plug-in system too early).

Auth header: implemented as HTTP Basic (client_id:client_secret) per the
originally-shared checkout doc page. The current v2 portal's own docs
describe "generate API keys" without showing the exact header in the
screenshots available while building this -- this is the first thing to
verify against a real TEST account once credentials exist, and the one
line to change (BASIC vs. an X-API-KEY-style header) if it turns out
different.
"""
import requests

from .models import NamastePayConfig

BASE_URLS = {
    NamastePayConfig.Environment.TEST: "https://testpay.namastepay.com",
    NamastePayConfig.Environment.LIVE: "https://checkout.namastepay.com",
}

TIMEOUT_SECONDS = 15


class NamastePayError(Exception):
    """Raised on any non-2xx response or malformed body -- callers must
    never treat a failed gateway call as success by accident, since a
    ticket/revenue record should never be created off the back of one."""
    def __init__(self, message, status_code=None, body=None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def _base_url(config: NamastePayConfig) -> str:
    return BASE_URLS[config.environment]


def _auth(config: NamastePayConfig):
    return (config.client_id, config.client_secret)


def initiate_checkout(config: NamastePayConfig, *, amount, order_id, return_url, customer=None, description=""):
    """POST /api/v2/initiate -- starts a hosted checkout, returns the
    dict the caller should read `id`/`url` from (field names kept as
    NamastePay's own response shape, not remapped, so this stays a thin
    passthrough)."""
    payload = {
        "amount": f"{amount:.2f}" if not isinstance(amount, str) else amount,
        "order_id": order_id,
        "return_url": return_url,
    }
    if description:
        payload["description"] = description
    if customer:
        payload["customer"] = customer

    resp = requests.post(
        f"{_base_url(config)}/api/v2/initiate",
        json=payload,
        auth=_auth(config),
        headers={"Accept": "application/json"},
        timeout=TIMEOUT_SECONDS,
    )
    if not resp.ok:
        raise NamastePayError(
            f"NamastePay initiate failed ({resp.status_code}).", status_code=resp.status_code, body=resp.text,
        )
    return resp.json()


def enquire_checkout(config: NamastePayConfig, checkout_id: str):
    """GET /api/v2/enquire/{checkout_id} -- the authoritative status check.
    Never trust a return_url's query-string status alone; always confirm
    here server-side before treating a payment as real."""
    resp = requests.get(
        f"{_base_url(config)}/api/v2/enquire/{checkout_id}",
        auth=_auth(config),
        headers={"Accept": "application/json"},
        timeout=TIMEOUT_SECONDS,
    )
    if not resp.ok:
        raise NamastePayError(
            f"NamastePay enquire failed ({resp.status_code}).", status_code=resp.status_code, body=resp.text,
        )
    return resp.json()
