"""
/public-api/v1/namastepay/ -- server-to-server lookup for Namaste Pay's own
backend. CB4 ("Ticket lookup API exposed safely for Namaste Pay to call"),
needed for P4: a passenger types a "ticket ID" into Namaste Pay's own
"CityBus" merchant profile (their requirement N5) and that screen calls this
endpoint to render route/bus/amount before offering a Pay button.

Not part of the Master API's trust boundary, and deliberately not grafted
onto partner_api/router.py's Yatroo scheme either -- that one is a heavier
HMAC+timestamp+nonce mechanism built for identity provisioning (minting a
passenger JWT), disproportionate for this endpoint's job (a stateless,
read-only lookup that mints nothing and creates nothing). Auth here is a
single static shared secret, constant-time compared -- see
verify_namastepay_secret below -- distinct from every other secret in this
service (INTERNAL_SERVICE_KEY is documented as "our own FastAPI service...
never an external partner"; YATROO_HMAC_SECRET is a different partner's
scheme entirely).

Looked up by NamastePayCheckout.reference_id (format "CB-<16 hex>"), not
Ticket.ticket_uid -- at the moment this endpoint is called, no Ticket exists
yet for either case it serves: a passenger's self-service checkout (CB9) or
a conductor-initiated walk-in checkout for a passenger with no CityBus
account (CB4's own extension to CB9, see public_api/router.py's
start_namastepay_checkout). reference_id is generated at checkout-creation
time specifically to be quoted externally as "the ticket ID" per the design
doc's P1/C2 flows.
"""
import hmac
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from ..config import settings
from ..public_api import tenant_db
from ..public_api.router import _error, _ok

router = APIRouter()


async def verify_namastepay_secret(x_namastepay_lookup_key: Optional[str] = Header(None)):
    expected = settings.NAMASTEPAY_LOOKUP_SECRET
    if not expected or not x_namastepay_lookup_key or not hmac.compare_digest(x_namastepay_lookup_key, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing X-NamastePay-Lookup-Key.")


_STATUS_MESSAGES = {
    "PENDING": "Ready to pay.",
    "CONFIRMED": "This ticket has already been paid for.",
    "FAILED": "This checkout has failed or expired -- ask for a new ticket ID.",
}


@router.get("/tickets/{reference_id}/", dependencies=[Depends(verify_namastepay_secret)])
async def lookup_ticket_for_namastepay(reference_id: str):
    """GET /namastepay/tickets/{reference_id}/ -- reference_id is the "ticket ID"
    quoted to the payer (NamastePayCheckout.reference_id, not Ticket.ticket_uid).
    Always 200 on a real match regardless of status -- route/bus/amount should
    still display for an already-CONFIRMED/FAILED checkout, just not payable
    again; `payable` is the explicit signal for that, so the caller never has
    to infer it from `status` string-matching."""
    found = await tenant_db.find_namastepay_checkout_by_reference(reference_id.strip().upper())
    if not found:
        return _error("Ticket ID not found.", 404)
    schema, checkout = found

    route = await tenant_db.fetch_route(str(checkout["route_id"])) if checkout.get("route_id") else None
    bus_number = (
        await tenant_db.fetch_vehicle_bus_number(schema, str(checkout["vehicle_id"]))
        if checkout.get("vehicle_id")
        else None
    )

    passengers = checkout.get("passengers") or []
    passenger_name = next((p.get("passenger_name") for p in passengers if p.get("passenger_name")), None) or "Passenger"

    return _ok(data={
        "reference_id": checkout["reference_id"],
        "route_name": route.get("name_en") if route else None,
        "route_code": route.get("route_code") if route else None,
        "bus_number": bus_number,
        "passenger_name": passenger_name,
        "amount": str(checkout["amount"]),
        "status": checkout["status"],
        "payable": checkout["status"] == "PENDING",
        "message": _STATUS_MESSAGES[checkout["status"]],
    })
