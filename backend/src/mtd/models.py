"""Pydantic models for MTD API responses."""

from pydantic import BaseModel


class DepartureItem(BaseModel):
    route: str
    headsign: str
    expected_mins: int
    expected_time_iso: str | None
    is_realtime: bool


class DeparturesResponse(BaseModel):
    stop_id: str
    departures: list[DepartureItem]


class StopInfo(BaseModel):
    stop_id: str
    stop_name: str
    lat: float
    lng: float


class NearbyStopsResponse(BaseModel):
    stops: list[StopInfo]
