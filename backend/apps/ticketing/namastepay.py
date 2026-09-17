"""NamastePay hosted-checkout client (Checkout v2). Every tenant hits the
same base URLs and request/response shapes; only the credentials differ,
so this is plain functions taking a NamastePayConfig rather than a
per-tenant class hierarchy -- there's only one gateway to support right
now (mirrors how this codebase keeps single-partner integrations concrete
instead of building a generalized plug-in system too early).

Auth + request/response shapes confirmed directly against NamastePay's own
published OpenAPI v2 spec (https://testpay.namastepay.com/api/v2/openapi.json)
-- not a guess: a single API key sent as the X-API-KEY header (generated via
their merchant portal), amounts as integers in paisa (not decimal NPR
strings), and initiate takes reference_id/remarks/amount_breakdown -- no
order_id, return_url, customer, or description field exists on their side.
Where a passenger lands after paying (the return URL) is confirmed set once
when generating the API key in NamastePay's merchant portal, not passed
per-request -- their own spec's callbacks section documents the redirect as
{$your_return_url}?checkout_id=...&reference_id=...&transaction_id=...&status=...&amount=...,
but that status is still just a query-string claim -- always confirm via
enquire_checkout() server-side before treating a payment as real.
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


def _headers(config: NamastePayConfig) -> dict:
    return {"X-API-KEY": config.api_key, "Accept": "application/json", "Content-Type": "application/json"}


def initiate_checkout(config: NamastePayConfig, *, amount, reference_id, remarks, amount_breakdown=None):
    """POST /api/v2/initiate -- starts a hosted checkout.

    `amount` is taken in NPR (matches how the rest of this codebase already
    thinks about money, e.g. Ticket.fare_paid) and converted to integer
    paisa here, since that's the unit NamastePay's API actually requires
    (range 1-20,000,000 paisa). `reference_id`/`remarks` are both required,
    max 256 chars each. `amount_breakdown`, if given, must be a dict of
    label -> paisa amounts summing to the total.

    Returns the dict the caller should read `checkout_id`/`payment_url`/
    `expires_at` from (field names kept as NamastePay's own response shape,
    not remapped, so this stays a thin passthrough)."""
    payload = {
        "amount": int(round(float(amount) * 100)),
        "reference_id": reference_id,
        "remarks": remarks,
    }
    if amount_breakdown:
        payload["amount_breakdown"] = amount_breakdown

    resp = requests.post(
        f"{_base_url(config)}/api/v2/initiate",
        json=payload,
        headers=_headers(config),
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
    here server-side before treating a payment as real. `status` is one of:
    initiated, success, failed, pending, refunded, canceled, expired."""
    resp = requests.get(
        f"{_base_url(config)}/api/v2/enquire/{checkout_id}",
        headers=_headers(config),
        timeout=TIMEOUT_SECONDS,
    )
    if not resp.ok:
        raise NamastePayError(
            f"NamastePay enquire failed ({resp.status_code}).", status_code=resp.status_code, body=resp.text,
        )
    return resp.json()
