from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


VALID_PHASES = frozenset({"walking", "waiting", "on_bus", "arrived"})


class CreateShareTripRequest(BaseModel):
    # Capped at the model layer so oversized input is rejected before it can
    # reach SQLite; the route only truncated `destination`, leaving the other
    # three fields as an unauthenticated path to fill the disk.
    destination: str = Field(..., max_length=200)
    route_id: Optional[str] = Field(None, max_length=64)
    route_name: Optional[str] = Field(None, max_length=120)
    stop_name: Optional[str] = Field(None, max_length=120)
    phase: str = "walking"
    eta_epoch: Optional[int] = None


class CreateShareTripResponse(BaseModel):
    token: str
    url: str


class PatchShareTripRequest(BaseModel):
    phase: Optional[str] = None
    eta_epoch: Optional[int] = None


class ShareTripStatusResponse(BaseModel):
    destination: Optional[str] = None
    route_id: Optional[str] = None
    route_name: Optional[str] = None
    stop_name: Optional[str] = None
    phase: Optional[str] = None
    eta_epoch: Optional[int] = None
    expired: bool = False
