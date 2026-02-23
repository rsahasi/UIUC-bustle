"""Pydantic models for POST /recommendation."""
from pydantic import BaseModel, Field, model_validator


class RecommendationRequest(BaseModel):
    lat: float
    lng: float
    destination_building_id: str = ""  # Optional when destination_lat/lng provided
    arrive_by_iso: str
    walking_speed_mps: float = Field(default=1.4, ge=0.1, le=3.0)
    buffer_minutes: float = Field(default=5.0, ge=0, le=60)
    max_options: int = Field(default=3, ge=1, le=10)
    destination_lat: float | None = None
    destination_lng: float | None = None
    destination_name: str | None = None

    @model_validator(mode="after")
    def check_coordinates(self):
        if not (-90 <= self.lat <= 90):
            raise ValueError("lat must be between -90 and 90")
        if not (-180 <= self.lng <= 180):
            raise ValueError("lng must be between -180 and 180")
        if self.destination_lat is not None and self.destination_lng is not None:
            if not (-90 <= self.destination_lat <= 90):
                raise ValueError("destination_lat must be between -90 and 90")
            if not (-180 <= self.destination_lng <= 180):
                raise ValueError("destination_lng must be between -180 and 180")
        return self


# Step types for stable, debuggable output
class StepWalkToStop(BaseModel):
    type: str = "WALK_TO_STOP"
    stop_id: str
    stop_name: str
    duration_minutes: float


class StepWait(BaseModel):
    type: str = "WAIT"
    stop_id: str
    duration_minutes: float


class StepRide(BaseModel):
    type: str = "RIDE"
    route: str
    headsign: str
    stop_id: str
    duration_minutes: float
    # TODO: add real route shape / stop sequence when available


class StepWalkToDest(BaseModel):
    type: str = "WALK_TO_DEST"
    building_id: str
    duration_minutes: float


# Discriminated union for steps (stable schema for API)
Step = StepWalkToStop | StepWait | StepRide | StepWalkToDest


class RecommendationOption(BaseModel):
    type: str  # "WALK" | "BUS"
    summary: str
    eta_minutes: float
    depart_in_minutes: float
    steps: list[dict]  # Step objects as dicts for stable JSON
    ai_explanation: str | None = None
    ai_ranked: bool = False


class RecommendationResponse(BaseModel):
    options: list[RecommendationOption]
