"""Pydantic models for MTD API responses."""

from pydantic import BaseModel


class DepartureItem(BaseModel):
    route: str
    headsign: str
    expected_mins: int
    expected_time_iso: str | None
    is_realtime: bool
    scheduled_mins: int | None = None
    delay_mins: int | None = None
    delay_status: str | None = None  # "on_time" | "delayed" | "early"


class DeparturesResponse(BaseModel):
    stop_id: str
    departures: list[DepartureItem]
    # "realtime" if any departure is live, else "scheduled" (GTFS times only).
    # Lets the client honestly label stale/scheduled data.
    source: str = "scheduled"
    generated_at: int = 0  # epoch seconds when this response was produced


class StopInfo(BaseModel):
    stop_id: str
    stop_name: str
    lat: float
    lng: float


class NearbyStopsResponse(BaseModel):
    stops: list[StopInfo]
