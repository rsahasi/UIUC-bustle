// src/hooks/useLeaveBy.ts
// Returns live departure status for the next upcoming class

import { useEffect, useRef, useState, useMemo } from "react";
import * as Location from "expo-location";
import type { RecommendationOption, RecommendationStep, ScheduleClass } from "@/src/api/types";
import type { RecommendationRequest } from "@/src/api/types";
import { useRecommendationSettings } from "@/src/hooks/useRecommendationSettings";
import { getNextClassToday } from "@/src/utils/nextClass";
import { arriveByIsoToday } from "@/src/utils/arriveBy";
import { getWeatherForLocation, getWalkMultiplier, WeatherData } from "@/src/utils/weatherEngine";
import { useClasses } from "@/src/queries/schedule";
import { useRecommendation } from "@/src/queries/recommendation";

export interface LeaveByOption {
  routeId: string;
  stopName: string;
  stopId: string;
  departureTime: string; // "HH:MM" format
  departureEpochMs: number;
  arrivalTimeStr: string; // "HH:MM" format
  walkToStopMins: number;
  rideTimeMins: number;
  walkFromStopMins: number;
  totalTimeMins: number;
  marginMins: number; // class start - arrival, positive = early
  status: "on-time" | "tight" | "late" | "walk-only";
}

export interface LeaveByState {
  nextClass: ScheduleClass | null;
  options: LeaveByOption[];
  walkOnlyMins: number | null; // walk time if walk-only is viable (< 30 min)
  isLoading: boolean;
  lastUpdated: Date | null;
  noViableBus: boolean; // all buses make user late
  weather: WeatherData | null;
}

const UIUC_FALLBACK = { lat: 40.102, lng: -88.2272 };
const LOOKAHEAD_HOURS = 3;

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function epochMsFromDepartInMinutes(departInMinutes: number): number {
  return Date.now() + departInMinutes * 60 * 1000;
}

function formatHHMM(epochMs: number): string {
  const d = new Date(epochMs);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function sumStepDuration(steps: RecommendationStep[], types: RecommendationStep["type"][]): number {
  return steps
    .filter((s) => types.includes(s.type))
    .reduce((acc, s) => acc + (s.duration_minutes ?? 0), 0);
}

function mapOptionToLeaveByOption(
  opt: RecommendationOption,
  classStartMins: number,
  now: Date
): LeaveByOption {
  const nowMins = minutesSinceMidnight(now);
  const departureEpochMs = epochMsFromDepartInMinutes(opt.depart_in_minutes);
  const departureTime = formatHHMM(departureEpochMs);
  const arrivalEpochMs = Date.now() + opt.eta_minutes * 60 * 1000;
  const arrivalTimeStr = formatHHMM(arrivalEpochMs);

  const walkToStopMins = sumStepDuration(opt.steps, ["WALK_TO_STOP"]);
  const rideTimeMins = sumStepDuration(opt.steps, ["RIDE"]);
  const walkFromStopMins = sumStepDuration(opt.steps, ["WALK_TO_DEST"]);
  const totalTimeMins = opt.eta_minutes;

  const marginMins = classStartMins - nowMins - totalTimeMins;

  let status: LeaveByOption["status"];
  if (opt.type === "WALK") {
    status = "walk-only";
  } else if (marginMins >= 5) {
    status = "on-time";
  } else if (marginMins >= 0) {
    status = "tight";
  } else {
    status = "late";
  }

  // Find the boarding stop from first WALK_TO_STOP or RIDE step
  const rideStep = opt.steps.find((s) => s.type === "RIDE");
  const walkToStopStep = opt.steps.find((s) => s.type === "WALK_TO_STOP");

  const stopName = walkToStopStep?.stop_name ?? rideStep?.stop_name ?? "";
  const stopId = walkToStopStep?.stop_id ?? rideStep?.stop_id ?? "";
  const routeId = rideStep?.route ?? "";

  return {
    routeId,
    stopName,
    stopId,
    departureTime,
    departureEpochMs,
    arrivalTimeStr,
    walkToStopMins,
    rideTimeMins,
    walkFromStopMins,
    totalTimeMins,
    marginMins,
    status,
  };
}

export function useLeaveBy(): LeaveByState {
  const { walkingSpeedMps, bufferMinutes, rainMode } = useRecommendationSettings();

  const locationRef = useRef<{ lat: number; lng: number }>(UIUC_FALLBACK);
  const [weather, setWeather] = useState<WeatherData | null>(null);

  // Load location and weather on mount (unchanged from original)
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          locationRef.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
        }
      } catch {
        // fall through to UIUC_FALLBACK
      }
      const { lat, lng } = locationRef.current;
      const w = await getWeatherForLocation(lat, lng);
      setWeather(w);
    })();
  }, []);

  // Classes from shared TQ cache — no more fetchClasses or setInterval needed
  const { data: classesData, isLoading: classesLoading } = useClasses();
  const allClasses = classesData?.classes ?? [];

  // Compute next class and recommendation params in render
  const recParams = useMemo<RecommendationRequest | null>(() => {
    const now = new Date();
    const nowMins = minutesSinceMidnight(now);
    const nextClass = getNextClassToday(allClasses, now);

    if (!nextClass) return null;

    const [ch, cm] = nextClass.start_time_local.split(":").map(Number);
    const classStartMins = (ch ?? 0) * 60 + (cm ?? 0);
    const minsUntilClass = classStartMins - nowMins;

    if (minsUntilClass > LOOKAHEAD_HOURS * 60 || minsUntilClass < 0) return null;

    const hasCustomDest =
      nextClass.destination_lat != null && nextClass.destination_lng != null;
    const weatherMult = weather ? getWalkMultiplier(weather) : 1.0;
    const effectiveWalkingSpeedMps = walkingSpeedMps / weatherMult;
    const weatherCondition = weather?.condition;
    const autoRainMode =
      weatherCondition === "RAIN" ||
      weatherCondition === "HEAVY_RAIN" ||
      weatherCondition === "STORM";

    return {
      lat: locationRef.current.lat,
      lng: locationRef.current.lng,
      ...(hasCustomDest
        ? {
            destination_lat: nextClass.destination_lat!,
            destination_lng: nextClass.destination_lng!,
            destination_name: nextClass.destination_name ?? undefined,
          }
        : { destination_building_id: nextClass.building_id }),
      arrive_by_iso: arriveByIsoToday(nextClass.start_time_local),
      walking_speed_mps: effectiveWalkingSpeedMps,
      buffer_minutes: bufferMinutes,
      max_options: 4,
      prefer_bus: rainMode || autoRainMode,
    };
  }, [allClasses, walkingSpeedMps, bufferMinutes, rainMode, weather]);

  // Recommendation from shared TQ cache — refetchInterval: 30_000 replaces setInterval
  const { data: recData, isLoading: recLoading } = useRecommendation(recParams);

  // Derive LeaveByState from TQ query results
  return useMemo<LeaveByState>(() => {
    const now = new Date();
    const nextClass = getNextClassToday(allClasses, now);

    if (classesLoading) {
      return {
        nextClass: null,
        options: [],
        walkOnlyMins: null,
        isLoading: true,
        lastUpdated: null,
        noViableBus: false,
        weather,
      };
    }

    if (!nextClass || !recParams) {
      return {
        nextClass: nextClass ?? null,
        options: [],
        walkOnlyMins: null,
        isLoading: false,
        lastUpdated: now,
        noViableBus: false,
        weather,
      };
    }

    if (recLoading) {
      return {
        nextClass,
        options: [],
        walkOnlyMins: null,
        isLoading: true,
        lastUpdated: null,
        noViableBus: false,
        weather,
      };
    }

    const [ch, cm] = nextClass.start_time_local.split(":").map(Number);
    const classStartMins = (ch ?? 0) * 60 + (cm ?? 0);
    const rawOptions = recData?.options ?? [];

    const walkOption = rawOptions.find((o) => o.type === "WALK");
    const busOptions = rawOptions.filter((o) => o.type !== "WALK");

    const mappedBusOptions: LeaveByOption[] = busOptions
      .map((opt) => mapOptionToLeaveByOption(opt, classStartMins, now))
      .sort((a, b) => b.marginMins - a.marginMins);

    const walkOnlyMins =
      walkOption && walkOption.eta_minutes < 30 ? walkOption.eta_minutes : null;

    const noViableBus =
      mappedBusOptions.length > 0 &&
      mappedBusOptions.every((o) => o.status === "late") &&
      walkOnlyMins == null;

    return {
      nextClass,
      options: mappedBusOptions,
      walkOnlyMins,
      isLoading: false,
      lastUpdated: now,
      noViableBus,
      weather,
    };
  }, [classesLoading, allClasses, recParams, recLoading, recData, weather]);
}

export default useLeaveBy;
