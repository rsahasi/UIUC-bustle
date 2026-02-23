/** GET /stops/nearby */
export interface StopInfo {
  stop_id: string;
  stop_name: string;
  lat: number;
  lng: number;
}

export interface NearbyStopsResponse {
  stops: StopInfo[];
}

/** GET /stops/{stop_id}/departures */
export interface DepartureItem {
  route: string;
  headsign: string;
  expected_mins: number;
  expected_time_iso: string | null;
  is_realtime: boolean;
}

export interface DeparturesResponse {
  stop_id: string;
  departures: DepartureItem[];
}

/** GET /buildings */
export interface Building {
  building_id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface BuildingsResponse {
  buildings: Building[];
}

/** GET/POST /schedule/classes */
export interface ScheduleClass {
  class_id: string;
  title: string;
  days_of_week: string[];
  start_time_local: string;
  building_id: string;
  destination_lat?: number | null;
  destination_lng?: number | null;
  destination_name?: string | null;
  end_time_local?: string | null;
}

/** GET /vehicles */
export interface VehicleInfo {
  vehicle_id: string;
  lat: number;
  lng: number;
  heading: number;
  route_id: string;
  headsign: string;
}

export interface VehiclesResponse {
  vehicles: VehicleInfo[];
}

export interface ClassesResponse {
  classes: ScheduleClass[];
}

/** POST /recommendation */
export interface RecommendationStep {
  type: "WALK_TO_STOP" | "WAIT" | "RIDE" | "WALK_TO_DEST";
  duration_minutes: number;
  stop_id?: string;
  stop_name?: string;
  stop_lat?: number;
  stop_lng?: number;
  building_id?: string;
  building_lat?: number;
  building_lng?: number;
  route?: string;
  headsign?: string;
  alighting_stop_id?: string | null;
  alighting_stop_lat?: number | null;
  alighting_stop_lng?: number | null;
}

export interface RecommendationOption {
  type: "WALK" | "BUS";
  summary: string;
  eta_minutes: number;
  depart_in_minutes: number;
  steps: RecommendationStep[];
  ai_explanation?: string | null;
  ai_ranked?: boolean;
}

export interface RecommendationRequest {
  lat: number;
  lng: number;
  /** Use when destination is a building. Omit when destination_lat/lng provided. */
  destination_building_id?: string;
  arrive_by_iso: string;
  walking_speed_mps?: number;
  buffer_minutes?: number;
  max_options?: number;
  /** Custom destination (e.g. general location). When set, recommendation uses this instead of building. */
  destination_lat?: number;
  destination_lng?: number;
  destination_name?: string;
}

export interface RecommendationResponse {
  options: RecommendationOption[];
}
