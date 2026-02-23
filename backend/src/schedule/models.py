"""Pydantic models for buildings and schedule/classes."""
import re
from pydantic import BaseModel, field_validator, model_validator

from src.data.buildings_repo import VALID_DAYS


class BuildingResponse(BaseModel):
    building_id: str
    name: str
    lat: float
    lng: float


class BuildingsListResponse(BaseModel):
    buildings: list[BuildingResponse]


# HH:MM (24h) or H:MM
TIME_LOCAL_PATTERN = re.compile(r"^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$")


class CreateClassRequest(BaseModel):
    title: str
    days_of_week: list[str]
    start_time_local: str
    building_id: str | None = None
    destination_lat: float | None = None
    destination_lng: float | None = None
    destination_name: str | None = None
    end_time_local: str | None = None

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Title must not be empty.")
        return v

    @field_validator("days_of_week")
    @classmethod
    def days_valid(cls, v: list[str]) -> list[str]:
        if not isinstance(v, list):
            raise ValueError("days_of_week must be a list of weekday codes.")
        out = []
        for d in v:
            d = (d or "").strip().upper()
            if d not in VALID_DAYS:
                raise ValueError(
                    f"Invalid day '{d}'. Use: MON, TUE, WED, THU, FRI, SAT, SUN."
                )
            out.append(d)
        if not out:
            raise ValueError("At least one day must be provided.")
        return out

    @field_validator("start_time_local")
    @classmethod
    def time_format(cls, v: str) -> str:
        v = (v or "").strip()
        if not TIME_LOCAL_PATTERN.match(v):
            raise ValueError("start_time_local must be in HH:MM format (24-hour), e.g. 09:30 or 14:00.")
        return v

    @field_validator("building_id")
    @classmethod
    def building_id_optional(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = (v or "").strip()
        return v if v else None

    @field_validator("destination_name", mode="before")
    @classmethod
    def destination_name_optional(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return (v or "").strip() or None

    @model_validator(mode="after")
    def require_building_or_destination(self):
        has_building = bool(self.building_id and self.building_id.strip())
        has_dest = self.destination_lat is not None and self.destination_lng is not None
        if not has_building and not has_dest:
            raise ValueError("Provide building_id or destination_lat and destination_lng (e.g. from address search).")
        if has_building and has_dest:
            raise ValueError("Provide either building_id or destination coordinates, not both.")
        return self


class ClassResponse(BaseModel):
    class_id: str
    title: str
    days_of_week: list[str]
    start_time_local: str
    building_id: str
    destination_lat: float | None = None
    destination_lng: float | None = None
    destination_name: str | None = None
    end_time_local: str | None = None


class ClassesListResponse(BaseModel):
    classes: list[ClassResponse]
