from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class GPSEvent(BaseModel):
    vehicle_id: str
    tenant_slug: str
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    speed: float = Field(default=0.0, ge=0)
    heading: float = Field(default=0.0, ge=0, le=360)
    timestamp: datetime
    trip_id: Optional[str] = None
    device_id: str


class GPSEventResponse(BaseModel):
    success: bool
    message: str
    alerts: list[str] = []


class VehiclePosition(BaseModel):
    vehicle_id: str
    tenant_slug: str
    latitude: float
    longitude: float
    speed: float
    heading: float
    timestamp: datetime
    trip_id: Optional[str] = None
    status: str = "active"


class LiveAlert(BaseModel):
    trip_id: Optional[str]
    vehicle_id: str
    alert_type: str
    severity: str
    message: str
    timestamp: datetime
    resolved: bool = False
