import { log } from "@/src/telemetry/logBuffer";
import type {
  Building,
  BuildingsResponse,
  ClassesResponse,
  DeparturesResponse,
  NearbyStopsResponse,
  RecommendationRequest,
  RecommendationResponse,
  ScheduleClass,
  VehiclesResponse,
} from "./types";

export type { Building, ClassesResponse, ScheduleClass } from "./types";
export type { RecommendationOption, RecommendationResponse, RecommendationStep } from "./types";
export type { DeparturesResponse, NearbyStopsResponse } from "./types";
export type { VehicleInfo, VehiclesResponse } from "./types";

export type RequestSignal = AbortSignal | undefined;

export interface RequestOptions {
  signal?: AbortSignal;
  /** Optional API key for production (X-API-Key header). */
  apiKey?: string | null;
}

function mergeHeaders(init?: RequestInit, apiKey?: string | null): RequestInit["headers"] {
  const headers = init?.headers instanceof Headers ? new Headers(init.headers) : new Headers(init?.headers as HeadersInit);
  if (apiKey?.trim()) headers.set("X-API-Key", apiKey.trim());
  return headers;
}

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2; // 3 attempts total
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 5000;

function isRetryable(status: number, err: unknown): boolean {
  if (status >= 500 && status < 600) return true;
  if (status === 429) return true;
  if (err instanceof TypeError && (err.message === "Network request failed" || err.message === "Failed to fetch")) return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  pathLabel: string,
  init?: RequestInit & { signal?: AbortSignal; apiKey?: string | null }
): Promise<Response> {
  const { signal: userSignal, apiKey, ...rest } = init ?? {};
  const headers = mergeHeaders(rest, apiKey);
  const requestInit: RequestInit & { signal?: AbortSignal } = { ...rest, headers };
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
    const signal = userSignal ?? timeoutController.signal;
    try {
      log.info(`api_request path=${pathLabel} attempt=${attempt + 1}`, { path: pathLabel });
      const res = await fetch(url, { ...requestInit, signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        log.warn(`api_response path=${pathLabel} status=${res.status}`, { path: pathLabel, status: res.status });
        if (attempt < MAX_RETRIES && isRetryable(res.status, null)) {
          const backoff = Math.min(RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 300, RETRY_MAX_MS);
          await delay(backoff);
          continue;
        }
        return res;
      }
      return res;
    } catch (e) {
      clearTimeout(timeoutId);
      lastError = e;
      const aborted = userSignal?.aborted ?? (e instanceof Error && e.name === "AbortError");
      if (aborted) {
        log.info(`api_aborted path=${pathLabel}`, { path: pathLabel });
        throw e;
      }
      log.error(`api_error path=${pathLabel} attempt=${attempt + 1}`, { path: pathLabel, error: e instanceof Error ? e.message : String(e) });
      if (attempt < MAX_RETRIES && isRetryable(0, e)) {
        const backoff = Math.min(RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 300, RETRY_MAX_MS);
        await delay(backoff);
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}

async function safeJson<T>(res: Response, pathLabel: string, fallback: T): Promise<T> {
  try {
    const data = await res.json();
    return data as T;
  } catch {
    log.warn(`api_json_parse_failed path=${pathLabel}`, { path: pathLabel });
    return fallback;
  }
}

/** Pass baseUrl from getStoredApiBaseUrl() or useApiBaseUrl() (no trailing slash). */
export async function fetchNearbyStops(
  baseUrl: string,
  lat: number,
  lng: number,
  radiusM = 800,
  options?: RequestOptions
): Promise<NearbyStopsResponse> {
  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}/stops/nearby?lat=${lat}&lng=${lng}&radius_m=${radiusM}`;
  const res = await fetchWithRetry(url, "/stops/nearby", options);
  if (!res.ok) throw new Error(`Stops: ${res.status}`);
  return safeJson(res, "/stops/nearby", { stops: [] });
}

export async function fetchDepartures(
  baseUrl: string,
  stopId: string,
  minutes = 60,
  options?: RequestOptions
): Promise<DeparturesResponse> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(
    `${base}/stops/${encodeURIComponent(stopId)}/departures?minutes=${minutes}`,
    "/stops/:id/departures",
    options
  );
  if (!res.ok) throw new Error(`Departures: ${res.status}`);
  return safeJson(res, "/stops/:id/departures", { stop_id: stopId, departures: [] });
}

export async function fetchBuildings(baseUrl: string, options?: RequestOptions): Promise<BuildingsResponse> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(`${base}/buildings`, "/buildings", options);
  if (!res.ok) throw new Error(`Buildings: ${res.status}`);
  return safeJson(res, "/buildings", { buildings: [] });
}

export async function fetchClasses(baseUrl: string, options?: RequestOptions): Promise<ClassesResponse> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(`${base}/schedule/classes`, "/schedule/classes", options);
  if (!res.ok) throw new Error(`Classes: ${res.status}`);
  return safeJson(res, "/schedule/classes", { classes: [] });
}

export async function createClass(
  baseUrl: string,
  body: {
    title: string;
    days_of_week: string[];
    start_time_local: string;
    building_id?: string | null;
    destination_lat?: number | null;
    destination_lng?: number | null;
    destination_name?: string | null;
    end_time_local?: string | null;
  },
  options?: RequestOptions
): Promise<ScheduleClass> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(`${base}/schedule/classes`, "POST /schedule/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
    apiKey: options?.apiKey,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `Classes: ${res.status}`);
  }
  try {
    return (await res.json()) as ScheduleClass;
  } catch {
    log.warn("api_json_parse_failed path=POST /schedule/classes", {});
    throw new Error("Invalid response from server");
  }
}

export async function fetchRecommendation(
  baseUrl: string,
  body: RecommendationRequest,
  options?: RequestOptions
): Promise<RecommendationResponse> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(`${base}/recommendation`, "/recommendation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
    apiKey: options?.apiKey,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `Recommendation: ${res.status}`);
  }
  const data = await safeJson(res, "/recommendation", { options: [] });
  return { options: Array.isArray(data.options) ? data.options : [] };
}

/** GET /health - use to verify API is reachable (e.g. from Settings). */
export async function fetchHealth(baseUrl: string, options?: RequestOptions): Promise<{ status: string }> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(`${base}/health`, "/health", options);
  if (!res.ok) throw new Error(`Health: ${res.status}`);
  return safeJson(res, "/health", { status: "ok" });
}

/** GET /vehicles?route_id=... - live vehicle positions */
export async function fetchVehicles(
  baseUrl: string,
  routeId?: string,
  options?: RequestOptions
): Promise<VehiclesResponse> {
  const base = baseUrl.replace(/\/$/, "");
  const params = routeId ? `?route_id=${encodeURIComponent(routeId)}` : "";
  const res = await fetchWithRetry(`${base}/vehicles${params}`, "/vehicles", options);
  if (!res.ok) throw new Error(`Vehicles: ${res.status}`);
  return safeJson(res, "/vehicles", { vehicles: [] });
}

/** DELETE /schedule/classes/:id */
export async function deleteClass(
  baseUrl: string,
  classId: string,
  options?: RequestOptions
): Promise<void> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(
    `${base}/schedule/classes/${encodeURIComponent(classId)}`,
    "DELETE /schedule/classes/:id",
    { method: "DELETE", signal: options?.signal, apiKey: options?.apiKey }
  );
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `Delete class: ${res.status}`);
  }
}

/** POST /ai/eod-report - end-of-day activity report */
export async function fetchEodReport(
  baseUrl: string,
  body: { entries: unknown[]; total_steps: number; total_calories: number; total_distance_m: number },
  options?: RequestOptions
): Promise<{ report: string; encouragement?: string; highlights?: string[] }> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(`${base}/ai/eod-report`, "POST /ai/eod-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
    apiKey: options?.apiKey,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `EOD report: ${res.status}`);
  }
  return safeJson(res, "POST /ai/eod-report", { report: "" });
}

/** GET /buildings/search?q=... - search buildings by name (ranked: exact → starts-with → contains) */
export async function fetchBuildingSearch(
  baseUrl: string,
  query: string,
  options?: RequestOptions
): Promise<BuildingsResponse> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(
    `${base}/buildings/search?q=${encodeURIComponent(query)}&limit=5`,
    "/buildings/search",
    options
  );
  if (!res.ok) return { buildings: [] };
  return safeJson(res, "/buildings/search", { buildings: [] });
}

/** GET /geocode?q=... - resolve place/address to lat, lng, display_name */
export interface GeocodeResult {
  lat: number;
  lng: number;
  display_name: string;
}
export async function fetchGeocode(
  baseUrl: string,
  query: string,
  options?: RequestOptions
): Promise<GeocodeResult> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetchWithRetry(
    `${base}/geocode?${encodeURIComponent("q")}=${encodeURIComponent(query)}`,
    "/geocode",
    options
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `Geocode: ${res.status}`);
  }
  return res.json() as Promise<GeocodeResult>;
}
