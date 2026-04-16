from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


VALID_PHASES = frozenset({"walking", "waiting", "on_bus", "arrived"})


class CreateShareTripRequest(BaseModel):
    destination: str
    route_id: Optional[str] = None
    route_name: Optional[str] = None
    stop_name: Optional[str] = None
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
