// src/hooks/useLeaveBy.ts
// Returns live departure status for the next upcoming class

import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { fetchClasses, fetchRecommendation } from "@/src/api/client";
import type { RecommendationOption, RecommendationStep, ScheduleClass } from "@/src/api/types";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useRecommendationSettings } from "@/src/hooks/useRecommendationSettings";
import { getNextClassToday } from "@/src/utils/nextClass";
import { arriveByIsoToday } from "@/src/utils/arriveBy";

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
}

const REFRESH_INTERVAL_MS = 30_000;
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
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { walkingSpeedMps, bufferMinutes, rainMode } = useRecommendationSettings();

  const [classes, setClasses] = useState<ScheduleClass[]>([]);
  const [state, setState] = useState<LeaveByState>({
    nextClass: null,
    options: [],
    walkOnlyMins: null,
    isLoading: true,
    lastUpdated: null,
    noViableBus: false,
  });

  const locationRef = useRef<{ lat: number; lng: number }>(UIUC_FALLBACK);
  const classesRef = useRef<ScheduleClass[]>([]);

  // Load location on mount
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          locationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
      } catch {
        // fall through to UIUC_FALLBACK
      }
    })();
  }, []);

  // Load classes on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetchClasses(apiBaseUrl, { apiKey: apiKey ?? undefined });
        setClasses(res.classes ?? []);
        classesRef.current = res.classes ?? [];
      } catch {
        // leave classes empty
      }
    })();
  }, [apiBaseUrl, apiKey]);

  // Keep classesRef in sync
  useEffect(() => {
    classesRef.current = classes;
  }, [classes]);

  const refresh = async () => {
    const now = new Date();
    const nowMins = minutesSinceMidnight(now);
    const allClasses = classesRef.current;
    const nextClass = getNextClassToday(allClasses, now);

    if (!nextClass) {
      setState((prev) => ({
        ...prev,
        nextClass: null,
        options: [],
        walkOnlyMins: null,
        isLoading: false,
        lastUpdated: now,
        noViableBus: false,
      }));
      return;
    }

    // Only fetch for classes within the next LOOKAHEAD_HOURS
    const [ch, cm] = nextClass.start_time_local.split(":").map(Number);
    const classStartMins = (ch ?? 0) * 60 + (cm ?? 0);
    const minsUntilClass = classStartMins - nowMins;
    if (minsUntilClass > LOOKAHEAD_HOURS * 60 || minsUntilClass < 0) {
      setState((prev) => ({
        ...prev,
        nextClass,
        options: [],
        walkOnlyMins: null,
        isLoading: false,
        lastUpdated: now,
        noViableBus: false,
      }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const loc = locationRef.current;
      const hasCustomDest =
        nextClass.destination_lat != null && nextClass.destination_lng != null;

      const rec = await fetchRecommendation(
        apiBaseUrl,
        {
          lat: loc.lat,
          lng: loc.lng,
          ...(hasCustomDest
            ? {
                destination_lat: nextClass.destination_lat!,
                destination_lng: nextClass.destination_lng!,
                destination_name: nextClass.destination_name ?? undefined,
              }
            : { destination_building_id: nextClass.building_id }),
          arrive_by_iso: arriveByIsoToday(nextClass.start_time_local),
          walking_speed_mps: walkingSpeedMps,
          buffer_minutes: bufferMinutes,
          max_options: 4,
          prefer_bus: rainMode,
        },
        { apiKey: apiKey ?? undefined }
      );

      const rawOptions = rec.options ?? [];

      // Separate walk-only and bus options
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

      setState({
        nextClass,
        options: mappedBusOptions,
        walkOnlyMins,
        isLoading: false,
        lastUpdated: now,
        noViableBus,
      });
    } catch {
      setState((prev) => ({
        ...prev,
        nextClass,
        isLoading: false,
        lastUpdated: now,
      }));
    }
  };

  // Initial fetch + 30s interval
  useEffect(() => {
    // Wait for classes to load before first refresh (slight delay)
    const initialTimer = setTimeout(() => {
      refresh();
    }, 500);

    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, apiKey, walkingSpeedMps, bufferMinutes, rainMode]);

  // Re-run refresh when classes are first loaded
  useEffect(() => {
    if (classes.length > 0) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes]);

  return state;
}

export default useLeaveBy;
