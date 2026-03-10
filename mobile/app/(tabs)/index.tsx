import { fetchAutocomplete, fetchBuildings, fetchClasses, fetchDepartures, fetchNearbyStops, fetchPlaceDetails, fetchPlacesAutocomplete, fetchRecommendation } from "@/src/api/client";
import type { AutocompleteResult, Building } from "@/src/api/client";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useClassNotificationsEnabled } from "@/src/hooks/useClassNotificationsEnabled";
import { useRecommendationSettings } from "@/src/hooks/useRecommendationSettings";
import { useLeaveBy } from "@/src/hooks/useLeaveBy";
import type { DepartureItem, RecommendationOption, RecommendationStep, StopInfo } from "@/src/api/types";
import { cancelClassReminder, cancelAllClassReminders, scheduleClassReminders } from "@/src/notifications/classReminders";
import { scheduleLeaveNowAlert, cancelLeaveNowAlert, cancelAllLeaveNowAlerts, buildLeaveNowBody } from "@/src/notifications/leaveNow";
import { addFavoriteStop, addFavoritePlace, getAfterLastClassPlaceId, getFavoritePlaces, type SavedPlace } from "@/src/storage/favorites";
import { getPinnedRoutes, addPinnedRoute, removePinnedRoute, type PinnedRoute } from "@/src/storage/pinnedRoutes";
import { getLastKnownHomeData, setLastKnownHomeData } from "@/src/storage/lastKnownHome";
import { setClassSummary, setClassRouteData } from "@/src/storage/classSummaryCache";
import type { ClassRouteData } from "@/src/storage/classSummaryCache";
import { buildRouteSummary, formatOptionLabel } from "@/src/utils/routeFormatting";
import { markClassAsWalkedToday } from "@/src/storage/walkedClassToday";
import { addRecentSearch, getRecentSearches, type RecentSearch } from "@/src/storage/recentSearches";
import { log } from "@/src/telemetry/logBuffer";
import { arriveByIsoToday } from "@/src/utils/arriveBy";
import { formatDistance, haversineMeters } from "@/src/utils/distance";
import { getNextClassToday } from "@/src/utils/nextClass";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
function newSessionToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutChangeEvent,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { theme } from "@/src/constants/theme";
import { ArrowRight, ChevronRight, Clock, MapPin, Search, Star, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";

const TOP_STOPS = 3;
const NEXT_DEPARTURES = 3;
const UIUC_FALLBACK = { lat: 40.102, lng: -88.2272 };
const LIVE_REFRESH_MS = 30_000;

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function NextUpArrow() {
  const translateX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(translateX, { toValue: 4, duration: 500, useNativeDriver: true }),
        Animated.timing(translateX, { toValue: 0, duration: 500, useNativeDriver: true }),
      ])
    ).start();
  }, [translateX]);
  return (
    <Animated.View style={{ transform: [{ translateX }] }}>
      <ArrowRight size={16} color={theme.colors.orange} />
    </Animated.View>
  );
}

function LiveBadge() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);
  return (
    <Animated.View style={[{ backgroundColor: theme.colors.orange, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }, { opacity }]}>
      <Text style={{ fontFamily: "DMSans_600SemiBold", fontSize: 10, color: "#fff" }}>Live</Text>
    </Animated.View>
  );
}

type StopWithDistance = StopInfo & { distance_m: number };

function optionCardTitle(index: number, opt: RecommendationOption): string {
  if (opt.type === "WALK") return "Walk";
  if (index === 0) return "Best option";
  return "Alternative";
}

/** Sum duration_minutes for steps that are walking (WALK_TO_STOP, WALK_TO_DEST). */
function sumWalkingMinutes(steps: RecommendationStep[]): number {
  return steps
    .filter((s) => s.type === "WALK_TO_STOP" || s.type === "WALK_TO_DEST")
    .reduce((acc, s) => acc + (s.duration_minutes ?? 0), 0);
}

/** Build a compact step-flow string like "Walk 4m → Bus 220 → Walk 0.4m" */
function buildStepFlow(steps: RecommendationStep[]): string {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.type === "WAIT") continue;
    if (s.type === "WALK_TO_STOP") {
      const mins = s.duration_minutes != null && s.duration_minutes > 0 ? `${Math.round(s.duration_minutes)}m` : "";
      parts.push(mins ? `Walk ${mins}` : "Walk to stop");
    } else if (s.type === "RIDE") {
      parts.push(`Bus ${s.route ?? ""}`.trim());
    } else if (s.type === "WALK_TO_DEST") {
      const mins = s.duration_minutes != null && s.duration_minutes > 0 ? `${Math.round(s.duration_minutes)}m` : "";
      // Skip the final walk-to-dest if it has no meaningful duration (e.g. alighting stop IS the destination)
      if (mins) parts.push(`Walk ${mins}`);
    }
  }
  return parts.join("  →  ");
}

/** Return a short label: "WALK", "BUS 220", "BUS 22 ALT" */
function getRouteLabel(opt: RecommendationOption, index: number): string {
  if (opt.type === "WALK") return "WALK";
  const rideStep = opt.steps.find((s) => s.type === "RIDE");
  const routeNum = rideStep?.route ?? "";
  const base = routeNum ? `BUS ${routeNum}` : "BUS";
  if (index === 0) return base;
  // For alternatives, show headsign abbreviation if available to differentiate
  const headsign = rideStep?.headsign ?? "";
  const suffix = headsign ? headsign.split(" ")[0].toUpperCase() : "ALT";
  return `${base} · ${suffix}`;
}

export default function HomeScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { enabled: classNotificationsEnabled } = useClassNotificationsEnabled();
  const { walkingModeId, walkingSpeedMps, bufferMinutes, rainMode } = useRecommendationSettings();
  const leaveBy = useLeaveBy();
  const router = useRouter();
  const params = useLocalSearchParams<{ highlight?: string; focus?: string }>();
  const [status, setStatus] = useState<"loading" | "error" | "denied" | "ready">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(UIUC_FALLBACK);
  const [stops, setStops] = useState<StopWithDistance[]>([]);
  const [departuresByStop, setDeparturesByStop] = useState<Record<string, DepartureItem[]>>({});
  const [scheduleClasses, setScheduleClasses] = useState<{ class_id: string; title: string; days_of_week: string[]; start_time_local: string; building_id: string }[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationOption[]>([]);
  const [afterLastClassPlace, setAfterLastClassPlace] = useState<SavedPlace | null>(null);
  const [afterLastClassRecs, setAfterLastClassRecs] = useState<RecommendationOption[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [highlightWalk, setHighlightWalk] = useState(false);
  const [offlineBanner, setOfflineBanner] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<RecommendationOption[]>([]);
  const [searchDestinationName, setSearchDestinationName] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [lastSearchGeo, setLastSearchGeo] = useState<{ lat: number; lng: number; displayName: string } | null>(null);
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<AutocompleteResult[]>([]);
  const [useUiucArea, setUseUiucArea] = useState(false);
  // Feature: Save from suggestions + post-search save button
  const [savedPlaceNames, setSavedPlaceNames] = useState<Set<string>>(new Set());
  const [searchDestSaved, setSearchDestSaved] = useState(false);
  // Feature: Get me home quick button
  const [homePlace, setHomePlace] = useState<SavedPlace | null>(null);
  // Feature: Pinned quick routes
  const [pinnedRoutes, setPinnedRoutes] = useState<PinnedRoute[]>([]);
  const [searchDestPinned, setSearchDestPinned] = useState(false);
  const [leaveNowBanner, setLeaveNowBanner] = useState<{ option: RecommendationOption; classTitle: string } | null>(null);
  const [routeSort, setRouteSort] = useState<'earliest' | 'fastest' | 'least-walk'>('earliest');
  const scrollRef = useRef<ScrollView>(null);
  const recommendationsY = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep latest stops ref for live refresh without re-running location
  const stopsRef = useRef<StopWithDistance[]>([]);
  // Keep latest location + classes refs for recommendation refresh
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);
  const classesRef = useRef<typeof scheduleClasses>([]);
  // Google Places session token — reset after each selection for billing grouping
  const sessionTokenRef = useRef<string>(newSessionToken());
  // Notification dedupe: only reschedule if classes changed or >10 min elapsed
  const lastNotifScheduleRef = useRef<{ key: string; at: number } | null>(null);

  const nextUp = getNextClassToday(scheduleClasses);

  // Load recent searches, saved places, and home place on mount
  useEffect(() => {
    getRecentSearches().then(setRecentSearches);
    (async () => {
      const [places, placeId, pinned] = await Promise.all([
        getFavoritePlaces(),
        getAfterLastClassPlaceId(),
        getPinnedRoutes(),
      ]);
      setSavedPlaceNames(new Set(places.map((p) => p.name)));
      if (placeId) setHomePlace(places.find((p) => p.id === placeId) ?? null);
      setPinnedRoutes(pinned);
    })();
  }, []);

  // Debounced two-tier autocomplete: backend (buildings + Google Places) as user types
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setAutocompleteSuggestions([]); return; }
    const timer = setTimeout(async () => {
      try {
        // Backend /autocomplete already merges buildings + Google Places in parallel
        const res = await fetchAutocomplete(apiBaseUrl, q, { apiKey: apiKey ?? undefined });
        setAutocompleteSuggestions(res.results ?? []);
      } catch {
        setAutocompleteSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, apiBaseUrl, apiKey]);

  useEffect(() => {
    if (params.highlight === "walk") setHighlightWalk(true);
  }, [params.highlight]);

  useEffect(() => {
    if (params.focus !== "recommendations") return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: recommendationsY.current,
        animated: true,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [params.focus]);

  /** Refresh recommendations for the next class using cached location. */
  const refreshRecommendations = useCallback(async () => {
    const loc = locationRef.current;
    if (!loc) return;
    const nextClass = getNextClassToday(classesRef.current);
    if (!nextClass) return;
    try {
      const hasCustomDest = nextClass.destination_lat != null && nextClass.destination_lng != null;
      const rec = await fetchRecommendation(apiBaseUrl, {
        lat: loc.lat,
        lng: loc.lng,
        ...(hasCustomDest
          ? {
              destination_lat: nextClass.destination_lat!,
              destination_lng: nextClass.destination_lng!,
              destination_name: nextClass.destination_name ?? "Class",
            }
          : { destination_building_id: nextClass.building_id }),
        arrive_by_iso: arriveByIsoToday(nextClass.start_time_local),
        max_options: 3,
        walking_speed_mps: walkingSpeedMps,
        buffer_minutes: bufferMinutes + (rainMode ? 5 : 0),
        prefer_bus: rainMode || undefined,
      }, { apiKey: apiKey ?? undefined });
      const opts = rec.options ?? [];
      setRecommendations(opts);
      if (classNotificationsEnabled && opts.length > 0) {
        const best = opts[0];
        setLeaveNowBanner(best.depart_in_minutes <= 2 ? { option: best, classTitle: nextClass.title } : null);
      }
    } catch {}
  }, [apiBaseUrl, apiKey, walkingSpeedMps, bufferMinutes, classNotificationsEnabled]);

  /** Lightweight refresh of departures only — no location or recommendation re-computation. */
  const refreshDepartures = useCallback(async () => {
    const currentStops = stopsRef.current;
    if (!currentStops.length) return;
    const depMap: Record<string, DepartureItem[]> = {};
    await Promise.all(
      currentStops.map(async (s) => {
        try {
          const res = await fetchDepartures(apiBaseUrl, s.stop_id, 60, { apiKey: apiKey ?? undefined });
          depMap[s.stop_id] = (res.departures || []).slice(0, NEXT_DEPARTURES);
        } catch {
          depMap[s.stop_id] = [];
        }
      })
    );
    setDeparturesByStop(depMap);
  }, [apiBaseUrl, apiKey]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setErrorMessage(null);
      setOfflineBanner(false);
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== "granted") {
          setStatus("denied");
          setStops([]);
          stopsRef.current = [];
          setDeparturesByStop({});
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (signal?.aborted) return;
        let { latitude, longitude } = loc.coords;
        // Snap to UIUC if GPS is far away (e.g. simulator default = San Francisco)
        const distToUiuc = haversineMeters(latitude, longitude, UIUC_FALLBACK.lat, UIUC_FALLBACK.lng);
        if (distToUiuc > 100_000) {
          latitude = UIUC_FALLBACK.lat;
          longitude = UIUC_FALLBACK.lng;
        }
        setLocation({ lat: latitude, lng: longitude });
        locationRef.current = { lat: latitude, lng: longitude };

        const [stopsData, classesData] = await Promise.all([
          fetchNearbyStops(apiBaseUrl, latitude, longitude, 800, { signal, apiKey: apiKey ?? undefined }),
          fetchClasses(apiBaseUrl, { signal, apiKey: apiKey ?? undefined }).catch(() => ({ classes: [] })),
        ]);
        if (signal?.aborted) return;
        const classes = classesData.classes ?? [];
        setScheduleClasses(classes);
        classesRef.current = classes;
        const data = stopsData;
        const withDist = data.stops
          .map((s) => ({
            ...s,
            distance_m: Math.round(haversineMeters(latitude, longitude, s.lat, s.lng)),
          }))
          .sort((a, b) => a.distance_m - b.distance_m)
          .slice(0, TOP_STOPS);
        setStops(withDist);
        stopsRef.current = withDist;

        const depMap: Record<string, DepartureItem[]> = {};
        await Promise.all(
          withDist.map(async (s) => {
            try {
              const res = await fetchDepartures(apiBaseUrl, s.stop_id, 60, { signal, apiKey: apiKey ?? undefined });
              depMap[s.stop_id] = (res.departures || []).slice(0, NEXT_DEPARTURES);
            } catch {
              depMap[s.stop_id] = [];
            }
          })
        );
        if (signal?.aborted) return;
        setDeparturesByStop(depMap);

        let recommendationsList: RecommendationOption[] = [];
        const nextClass = getNextClassToday(classes);
        if (nextClass) {
          try {
            const hasCustomDest = nextClass.destination_lat != null && nextClass.destination_lng != null;
            const rec = await fetchRecommendation(apiBaseUrl, {
              lat: latitude,
              lng: longitude,
              ...(hasCustomDest
                ? {
                    destination_lat: nextClass.destination_lat!,
                    destination_lng: nextClass.destination_lng!,
                    destination_name: nextClass.destination_name ?? "Class",
                  }
                : { destination_building_id: nextClass.building_id }),
              arrive_by_iso: arriveByIsoToday(nextClass.start_time_local),
              max_options: 3,
              walking_speed_mps: walkingSpeedMps,
              buffer_minutes: bufferMinutes,
            }, { signal, apiKey: apiKey ?? undefined });
            recommendationsList = rec.options ?? [];
            setRecommendations(recommendationsList);
            setAfterLastClassPlace(null);
            setAfterLastClassRecs([]);
            // Cache route summary for notification
            if (recommendationsList.length > 0) {
              const summary = buildRouteSummary(recommendationsList);
              if (summary) await setClassSummary(nextClass.class_id, summary);
              const routeData: ClassRouteData = {
                summary,
                bestDepartInMinutes: Math.min(...recommendationsList.map((o) => o.depart_in_minutes)),
                etaMinutes: recommendationsList[0]?.eta_minutes ?? 0,
                options: recommendationsList.map((o) => ({ label: formatOptionLabel(o), departInMinutes: o.depart_in_minutes })),
              };
              await setClassRouteData(nextClass.class_id, routeData);
            }
            // Schedule / re-schedule live "Leave Now" push notification
            if (classNotificationsEnabled && recommendationsList.length > 0) {
              const best = recommendationsList[0];
              try { await scheduleLeaveNowAlert(nextClass.class_id, nextClass.title, best); } catch (_) {}
              setLeaveNowBanner(best.depart_in_minutes <= 2 ? { option: best, classTitle: nextClass.title } : null);
            }
          } catch {
            setRecommendations([]);
          }
        } else {
          setRecommendations([]);
          const placeId = await getAfterLastClassPlaceId();
          const places = await getFavoritePlaces();
          const place = places.find((p) => p.id === placeId) ?? null;
          setAfterLastClassPlace(place);
          if (place && !signal?.aborted) {
            try {
              const arriveBy = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
              const rec = await fetchRecommendation(apiBaseUrl, {
                lat: latitude,
                lng: longitude,
                destination_lat: place.lat,
                destination_lng: place.lng,
                destination_name: place.name,
                arrive_by_iso: arriveBy,
                max_options: 3,
                walking_speed_mps: walkingSpeedMps,
                buffer_minutes: bufferMinutes,
              }, { signal, apiKey: apiKey ?? undefined });
              if (!signal?.aborted) setAfterLastClassRecs(rec.options ?? []);
            } catch {
              setAfterLastClassRecs([]);
            }
          } else {
            setAfterLastClassRecs([]);
          }
        }

        if (signal?.aborted) return;
        if (classNotificationsEnabled) {
          const classKey = classes.map((c) => c.class_id).sort().join(",");
          const shouldReschedule =
            !lastNotifScheduleRef.current ||
            lastNotifScheduleRef.current.key !== classKey ||
            Date.now() - lastNotifScheduleRef.current.at > 10 * 60 * 1000;
          if (shouldReschedule) {
            lastNotifScheduleRef.current = { key: classKey, at: Date.now() };
            try {
              await cancelAllClassReminders();
              await cancelAllLeaveNowAlerts();
              const buildingsRes = await fetchBuildings(apiBaseUrl, { signal, apiKey: apiKey ?? undefined }).catch(() => ({ buildings: [] }));
              const buildingMap: Record<string, string> = {};
              for (const b of buildingsRes.buildings ?? []) buildingMap[b.building_id] = b.name;
              await scheduleClassReminders(classes, buildingMap, walkingSpeedMps, bufferMinutes);
            } catch (_) {
              await scheduleClassReminders(classes, {}, walkingSpeedMps, bufferMinutes);
            }
          }
        }

        setStatus("ready");
        await setLastKnownHomeData({
          stops: withDist,
          departuresByStop: depMap,
          scheduleClasses: classes,
          recommendations: recommendationsList,
          location: { lat: latitude, lng: longitude },
        });
      } catch (e) {
        const isAbort = e instanceof Error && e.name === "AbortError";
        if (isAbort) {
          log.info("home_load_aborted");
          return;
        }
        const lastKnown = await getLastKnownHomeData();
        if (lastKnown && (lastKnown.stops.length > 0 || lastKnown.scheduleClasses.length > 0)) {
          setStops(lastKnown.stops);
          stopsRef.current = lastKnown.stops;
          setDeparturesByStop((lastKnown.departuresByStop ?? {}) as Record<string, DepartureItem[]>);
          setScheduleClasses(lastKnown.scheduleClasses);
          setRecommendations((lastKnown.recommendations ?? []) as RecommendationOption[]);
          setAfterLastClassPlace(null);
          setAfterLastClassRecs([]);
          setStatus("ready");
          setOfflineBanner(true);
          log.warn("home_offline_using_cache", { savedAt: lastKnown.savedAt });
        } else {
          setStatus("error");
          setErrorMessage(e instanceof Error ? e.message : "Something went wrong");
          setStops([]);
          stopsRef.current = [];
          setDeparturesByStop({});
          setRecommendations([]);
        }
      } finally {
        setRefreshing(false);
      }
    },
    [apiBaseUrl, classNotificationsEnabled, walkingSpeedMps, bufferMinutes, useUiucArea]
  );

  useEffect(() => {
    let mounted = true;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    (async () => {
      const lastKnown = await getLastKnownHomeData();
      if (lastKnown && lastKnown.stops.length > 0) {
        setStops(lastKnown.stops);
        stopsRef.current = lastKnown.stops;
        setDeparturesByStop((lastKnown.departuresByStop ?? {}) as Record<string, DepartureItem[]>);
        setScheduleClasses(lastKnown.scheduleClasses);
        setRecommendations((lastKnown.recommendations ?? []) as RecommendationOption[]);
        setAfterLastClassPlace(null);
        setAfterLastClassRecs([]);
        if (mounted) setStatus("ready");
      }
      if (mounted) load(signal);
    })();

    // Live departure + recommendation refresh every 30 seconds
    liveIntervalRef.current = setInterval(() => {
      refreshDepartures();
      refreshRecommendations();
    }, LIVE_REFRESH_MS);

    return () => {
      mounted = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [load, refreshDepartures, refreshRecommendations]);

  const onRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    setRefreshing(true);
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      load(abortRef.current.signal);
    }, 400);
  }, [load]);

  const onStartWalk = useCallback((opt: RecommendationOption, destNameOverride?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const step = opt.steps.find((s) => s.type === "WALK_TO_DEST");
    if (step?.building_lat != null && step?.building_lng != null) {
      router.push({
        pathname: "/walk-nav",
        params: {
          dest_lat: String(step.building_lat),
          dest_lng: String(step.building_lng),
          dest_name: destNameOverride ?? nextUp?.title ?? "Destination",
          walking_mode_id: walkingModeId,
          building_id: nextUp?.building_id ?? "",
          arrive_by_class_time: nextUp?.start_time_local ?? "",
        },
      });
    }
  }, [router, nextUp, walkingModeId]);

  const onStartBus = useCallback(
    (opt: RecommendationOption) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Walk to the bus stop using the internal walk-nav map (no app switching)
      const step = opt.steps.find((s) => s.type === "WALK_TO_STOP");
      const rideStep = opt.steps.find((s) => s.type === "RIDE");
      const destStep = opt.steps.find((s) => s.type === "WALK_TO_DEST");
      const routeId = rideStep?.route ?? "";
      const alightingStopId = rideStep?.alighting_stop_id ?? "";
      const alightingLat = rideStep?.alighting_stop_lat ?? null;
      const alightingLng = rideStep?.alighting_stop_lng ?? null;
      const busDepEpochMs = Date.now() + opt.depart_in_minutes * 60000;
      if (step?.stop_lat != null && step?.stop_lng != null) {
        router.push({
          pathname: "/walk-nav",
          params: {
            dest_lat: String(step.stop_lat),
            dest_lng: String(step.stop_lng),
            dest_name: step.stop_name ?? "Bus Stop",
            walking_mode_id: walkingModeId,
            route_id: routeId,
            stop_id: step.stop_id ?? "",
            alighting_stop_id: alightingStopId ?? "",
            alighting_lat: alightingLat != null ? String(alightingLat) : "",
            alighting_lng: alightingLng != null ? String(alightingLng) : "",
            bus_dep_epoch_ms: String(busDepEpochMs),
            arrive_by_class_time: nextUp?.start_time_local ?? "",
            final_lat: destStep?.building_lat != null ? String(destStep.building_lat) : "",
            final_lng: destStep?.building_lng != null ? String(destStep.building_lng) : "",
            final_name: nextUp?.title ?? "",
          },
        });
      }
    },
    [router, walkingModeId, nextUp]
  );

  const onWalkingToClass = useCallback(async () => {
    if (!nextUp) return;
    await markClassAsWalkedToday(nextUp.class_id);
    await cancelClassReminder(nextUp.class_id);
    await cancelLeaveNowAlert(nextUp.class_id);
    setLeaveNowBanner(null);
  }, [nextUp]);

  /** Shared recommendation fetch used by both search paths. */
  const _fetchRoutesTo = useCallback(async (destLat: number, destLng: number, destName: string, queryLabel: string) => {
    if (!location) return;
    setSearchDestSaved(false);
    setSearchDestPinned(false);
    const arriveBy = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const rec = await fetchRecommendation(apiBaseUrl, {
      lat: location.lat,
      lng: location.lng,
      destination_lat: destLat,
      destination_lng: destLng,
      destination_name: destName,
      arrive_by_iso: arriveBy,
      max_options: 3,
      walking_speed_mps: walkingSpeedMps,
      buffer_minutes: bufferMinutes,
    }, { apiKey: apiKey ?? undefined });
    setSearchResults(rec.options ?? []);
    setSearchDestinationName(destName);
    setLastSearchGeo({ lat: destLat, lng: destLng, displayName: destName });
    await addRecentSearch({ query: queryLabel, displayName: destName, lat: destLat, lng: destLng });
    setRecentSearches(await getRecentSearches());
  }, [apiBaseUrl, apiKey, location, walkingSpeedMps, bufferMinutes]);

  const onGetMeHome = useCallback(async () => {
    if (!homePlace || !location) return;
    setSearchQuery(homePlace.name);
    setSearchLoading(true);
    setSearchResults([]);
    setSearchDestinationName(null);
    setSearchDestSaved(false);
    setSearchError(null);
    setAutocompleteSuggestions([]);
    try {
      await _fetchRoutesTo(homePlace.lat, homePlace.lng, homePlace.name, homePlace.name);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearchLoading(false);
    }
  }, [homePlace, location, _fetchRoutesTo]);

  /** Tap any autocomplete suggestion (building, place, or google_place) — immediately loads routes. */
  const onSelectSuggestion = useCallback(async (item: AutocompleteResult) => {
    const displayName = item.display_name?.split(",")[0]?.trim() || item.name;
    setSearchQuery(displayName);
    setAutocompleteSuggestions([]);
    setSearchError(null);
    setSearchResults([]);
    setSearchDestinationName(null);
    setSearchLoading(true);
    // Reset session token after selection (new session for next search)
    sessionTokenRef.current = newSessionToken();
    try {
      let lat = item.lat;
      let lng = item.lng;
      let resolvedName = item.display_name || item.name;
      // For Google Places results (lat=0, place_id set): resolve via /places/details
      if (item.type === "google_place" && item.place_id && (lat === 0 || lng === 0)) {
        const details = await fetchPlaceDetails(apiBaseUrl, item.place_id, { apiKey: apiKey ?? undefined });
        lat = details.lat;
        lng = details.lng;
        if (details.display_name) resolvedName = details.display_name;
      }
      await _fetchRoutesTo(lat, lng, resolvedName, displayName);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [_fetchRoutesTo, apiBaseUrl, apiKey]);

  const onSearchDestination = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q || !location) return;
    setSearchError(null);
    setSearchResults([]);
    setSearchDestinationName(null);
    setAutocompleteSuggestions([]);
    setSearchLoading(true);
    try {
      // Use the autocomplete endpoint to resolve: tries buildings first, then Nominatim
      const acRes = await fetchAutocomplete(apiBaseUrl, q, { apiKey: apiKey ?? undefined });
      if (acRes.results.length > 0) {
        const best = acRes.results[0];
        const destName = best.display_name || best.name;
        await _fetchRoutesTo(best.lat, best.lng, destName, q);
      } else {
        setSearchError("No results found. Try a different name or address.");
        setSearchResults([]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Search failed.";
      setSearchError(msg.includes("Geocoding") || msg.includes("unavailable")
        ? "Geocoding service unavailable. Is the backend running?"
        : msg);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [apiBaseUrl, apiKey, location, searchQuery, _fetchRoutesTo]);

  if (status === "loading" && !refreshing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.navy} />
        <Text style={styles.centeredText}>Getting location and nearby stops…</Text>
      </View>
    );
  }

  if (status === "denied") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Location permission denied</Text>
        <Text style={styles.hint}>Enable location in Settings to see nearby stops.</Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => Linking.openSettings()}
          accessibilityLabel="Open location settings"
          accessibilityRole="button"
        >
          <Text style={styles.retryBtnText}>Open Location Settings</Text>
        </Pressable>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Error</Text>
        <Text style={styles.hint}>{errorMessage}</Text>
        <Text style={styles.hint}>Check API URL in Settings and that the backend is running.</Text>
        <Pressable
          accessibilityLabel="Retry loading"
          accessibilityRole="button"
          onPress={() => { setRefreshing(true); load(); }}
          style={styles.retryBtn}
        >
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
        <Pressable style={[styles.retryBtn, styles.retryBtnSecondary]} onPress={() => { setUseUiucArea(true); setRefreshing(true); abortRef.current?.abort(); abortRef.current = new AbortController(); load(abortRef.current.signal); }}>
          <Text style={styles.retryBtnSecondaryText}>Use UIUC area (test MTD)</Text>
        </Pressable>
      </View>
    );
  }

  /** Determine on-time status of an option vs the next class start time. */
  const optionStatus = (opt: RecommendationOption, nextClassStartTime?: string): 'on-time' | 'tight' | 'late' | 'walk-only' => {
    if (opt.type === 'WALK') return 'walk-only';
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (!nextClassStartTime) return 'on-time';
    const [h, m] = nextClassStartTime.split(':').map(Number);
    const classMins = (h ?? 0) * 60 + (m ?? 0);
    const arrivalMins = nowMins + opt.depart_in_minutes + opt.eta_minutes;
    const margin = classMins - arrivalMins;
    if (margin >= 5) return 'on-time';
    if (margin >= 0) return 'tight';
    return 'late';
  };

  /** Sort a list of route options by the current routeSort state. */
  const sortedOptions = (opts: RecommendationOption[]): RecommendationOption[] => {
    const copy = [...opts];
    if (routeSort === 'earliest') {
      copy.sort((a, b) => a.depart_in_minutes - b.depart_in_minutes);
    } else if (routeSort === 'fastest') {
      copy.sort((a, b) => a.eta_minutes - b.eta_minutes);
    } else if (routeSort === 'least-walk') {
      const walkSum = (o: RecommendationOption) =>
        o.steps
          .filter((s) => s.type === 'WALK_TO_STOP' || s.type === 'WALK_TO_DEST')
          .reduce((acc, s) => acc + (s.duration_minutes ?? 0), 0);
      copy.sort((a, b) => walkSum(a) - walkSum(b));
    }
    return copy;
  };

  /** Build a shareable ETA message for this route option. */
  const buildShareMessage = (opt: RecommendationOption, destName: string): string => {
    const dest = destName.split(",")[0];
    if (opt.type === "WALK") return `Walking to ${dest} — arriving in ~${opt.eta_minutes} min`;
    const rideStep = opt.steps.find((s) => s.type === "RIDE");
    const route = rideStep?.route ? `Bus ${rideStep.route}` : "bus";
    const depart = Math.round(opt.depart_in_minutes);
    const departStr = depart <= 1 ? "leaving now" : `leaving in ${depart} min`;
    return `Taking ${route} to ${dest} — ${departStr}, arriving in ~${opt.eta_minutes} min`;
  };

  /** Render a single option card — shared between search results, after-class recs, and class recommendations. */
  const renderOptionCard = (
    opt: RecommendationOption,
    index: number,
    key: string,
    isHighlighted: boolean,
    onStart: () => void,
    destName: string = "destination",
    classStartTime?: string
  ) => {
    const isWalk = opt.type === "WALK";
    const isBestBus = !isWalk && index === 0;
    const label = getRouteLabel(opt, index);
    const stepFlow = buildStepFlow(opt.steps);
    const departMins = Math.round(opt.depart_in_minutes);
    const departNow = departMins <= 1;
    const accentColor = isWalk || isBestBus ? theme.colors.orange : theme.colors.border;
    const status = optionStatus(opt, classStartTime);
    const statusColors: Record<string, string> = {
      'on-time': theme.colors.success,
      'tight': theme.colors.warning,
      'late': theme.colors.error,
      'walk-only': theme.colors.navy,
    };
    const statusLabels: Record<string, string> = {
      'on-time': 'ON TIME',
      'tight': 'TIGHT',
      'late': 'LATE',
      'walk-only': 'WALK',
    };

    return (
      <View
        key={key}
        style={[
          styles.optionCard,
          { borderLeftColor: accentColor },
          isHighlighted && styles.optionCardHighlight,
        ]}
      >
        {/* Top row: type badge + status pill + departure countdown */}
        <View style={styles.cardTopRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <View style={[styles.cardTypeBadge, isWalk ? styles.cardTypeBadgeWalk : styles.cardTypeBadgeBus]}>
              <Text style={styles.cardTypeBadgeText}>{label}</Text>
            </View>
            {classStartTime && (
              <View style={[styles.optionStatusPill, { backgroundColor: statusColors[status] }]}>
                <Text style={styles.optionStatusText}>{statusLabels[status]}</Text>
              </View>
            )}
          </View>
          <Text style={departNow ? styles.cardDepartNow : styles.cardDepartTime}>
            {isWalk
              ? `${opt.eta_minutes} min`
              : departNow
              ? "Now"
              : `${departMins} min`}
          </Text>
        </View>

        {/* Step flow */}
        {stepFlow.length > 0 && (
          <Text style={styles.stepFlowText} numberOfLines={1}>{stepFlow}</Text>
        )}

        {/* AI explanation if present */}
        {!isWalk && (
          <Text style={styles.mtdFree}>$0 — MTD is free</Text>
        )}

        {opt.ai_explanation && (
          <Text style={styles.aiExplanation} numberOfLines={2}>Claude: {opt.ai_explanation}</Text>
        )}

        {/* Bottom row: total time + share + inline start button */}
        <View style={styles.cardBottomRow}>
          <Text style={styles.cardTotalTime}>
            {isWalk
              ? "Walk only"
              : `${opt.eta_minutes} min total`}
          </Text>
          <View style={styles.cardActions}>
            <Pressable
              accessibilityLabel="Share ETA"
              accessibilityRole="button"
              style={styles.shareBtn}
              onPress={() => Share.share({ message: buildShareMessage(opt, destName) })}
            >
              <Text style={styles.shareBtnText}>Share</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={isWalk ? "Start walking directions" : "Start bus option"}
              accessibilityRole="button"
              style={styles.startBtnInline}
              onPress={onStart}
            >
              <Text style={styles.startBtnInlineText}>Start →</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.navy} />
      }
    >
      {offlineBanner && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Offline — showing last saved data.</Text>
          <Pressable onPress={onRefresh} accessibilityRole="button" accessibilityLabel="Retry loading">
            <Text style={styles.offlineBannerRetry}>Retry</Text>
          </Pressable>
        </View>
      )}
      {useUiucArea && (
        <View style={styles.uiucBanner}>
          <Text style={styles.uiucBannerText}>Showing UIUC area (Champaign-Urbana) for testing</Text>
          <Pressable onPress={() => { setUseUiucArea(false); onRefresh(); }}>
            <Text style={styles.uiucBannerLink}>Use my location</Text>
          </Pressable>
        </View>
      )}

      {/* Rain mode banner */}
      {rainMode && (
        <View style={styles.rainBanner}>
          <Text style={styles.rainBannerText}>Rain mode on — bus routes prioritised, +5 min buffer</Text>
          <Pressable onPress={() => {}} accessibilityRole="button" accessibilityLabel="Rain mode active">
            <Text style={styles.rainBannerIcon}>☂</Text>
          </Pressable>
        </View>
      )}

      {/* Greeting */}
      <Text style={styles.greeting}>{getGreeting()}</Text>

      {/* Search card */}
      <View style={styles.searchCard}>
        <Text style={styles.searchLabel}>Where to?</Text>
        {(homePlace || pinnedRoutes.length > 0) && !searchQuery.trim() && !searchLoading && (
          <View style={styles.quickChipsRow}>
            {homePlace && (
              <Pressable
                style={styles.homePlaceChip}
                onPress={onGetMeHome}
                accessibilityLabel={`Get me to ${homePlace.name}`}
                accessibilityRole="button"
              >
                <Text style={styles.homePlaceChipText}>→ {homePlace.name}</Text>
              </Pressable>
            )}
            {pinnedRoutes.map((pin) => (
              <Pressable
                key={pin.id}
                style={styles.pinnedChip}
                onPress={async () => {
                  setSearchQuery(pin.destName);
                  setSearchLoading(true);
                  setSearchResults([]);
                  setSearchDestinationName(null);
                  setSearchDestSaved(false);
                  setSearchError(null);
                  setAutocompleteSuggestions([]);
                  try {
                    await _fetchRoutesTo(pin.destLat, pin.destLng, pin.destName, pin.destName);
                  } catch (e) {
                    setSearchError(e instanceof Error ? e.message : "Search failed.");
                  } finally {
                    setSearchLoading(false);
                  }
                }}
                onLongPress={async () => {
                  Alert.alert("Remove pin", `Unpin "${pin.destName}"?`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Remove", style: "destructive", onPress: async () => {
                      await removePinnedRoute(pin.id);
                      setPinnedRoutes(await getPinnedRoutes());
                    }},
                  ]);
                }}
              >
                <Text style={styles.pinnedChipText}>{pin.destName}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={styles.searchInputWrapper}>
          <Search size={18} color={theme.colors.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="e.g. Siebel, Illini Union, or an address"
            placeholderTextColor={theme.colors.textMuted}
            value={searchQuery}
            onChangeText={(t) => { setSearchQuery(t); setSearchError(null); if (!t.trim()) setAutocompleteSuggestions([]); }}
            onSubmitEditing={onSearchDestination}
            editable={!searchLoading}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => { setSearchQuery(""); setAutocompleteSuggestions([]); setSearchError(null); }}>
              <X size={16} color={theme.colors.textMuted} />
            </Pressable>
          )}
        </View>
        {autocompleteSuggestions.length > 0 && (
          <View style={styles.suggestionsList}>
            {autocompleteSuggestions.map((item, i) => (
              <View key={`${item.type}-${i}`} style={styles.suggestionItem}>
                <Pressable
                  style={styles.suggestionMain}
                  onPress={() => onSelectSuggestion(item)}
                >
                  <View style={styles.suggestionRow}>
                    <Text style={styles.suggestionText} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.type === "building" && (
                      <Text style={styles.suggestionType}>UIUC</Text>
                    )}
                  </View>
                  {(item.secondary_text || (item.display_name && item.display_name !== item.name)) && (
                    <Text style={styles.suggestionSub} numberOfLines={1}>
                      {item.secondary_text || item.display_name?.split(",").slice(1, 3).join(",").trim()}
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  style={styles.suggestionSaveBtn}
                  accessibilityLabel={`Save ${item.name} as favorite`}
                  onPress={async () => {
                    const name = item.name;
                    let lat = item.lat;
                    let lng = item.lng;
                    if (item.type === "google_place" && item.place_id && (lat === 0 || lng === 0)) {
                      try {
                        const details = await fetchPlaceDetails(apiBaseUrl, item.place_id, { apiKey: apiKey ?? undefined });
                        lat = details.lat;
                        lng = details.lng;
                      } catch {}
                    }
                    await addFavoritePlace({ name, lat, lng });
                    setSavedPlaceNames((prev) => new Set([...prev, name]));
                  }}
                >
                  <Star size={18} color={theme.colors.orange} fill={savedPlaceNames.has(item.name) ? theme.colors.orange : "none"} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <Pressable
          style={({ pressed }) => [styles.searchBtn, searchLoading && styles.searchBtnDisabled, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSearchDestination(); }}
          disabled={searchLoading || !searchQuery.trim() || !location}
        >
          {searchLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.searchBtnText}>Get routes</Text>
          )}
        </Pressable>
        {searchError && <Text style={styles.searchError}>{searchError}</Text>}
        {recentSearches.length > 0 && !searchResults.length && !autocompleteSuggestions.length && (
          <View style={styles.recentSearches}>
            <Text style={styles.recentLabel}>Recent:</Text>
            {recentSearches.map((r, i) => (
              <Pressable
                key={i}
                style={styles.recentItem}
                onPress={() => setSearchQuery(r.query)}
              >
                <Clock size={14} color={theme.colors.textMuted} style={{ marginRight: 8 }} />
                <Text style={styles.recentItemText}>{r.displayName.split(",")[0]}</Text>
                <ChevronRight size={14} color={theme.colors.textMuted} />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Search results */}
      {searchDestinationName && searchResults.length > 0 && (
        <View style={styles.recommendationsSection}>
          <View style={styles.searchResultsHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Routes to</Text>
              <Text style={styles.sectionSubtitle}>{searchDestinationName.split(",")[0]}</Text>
            </View>
            {lastSearchGeo && (
              <View style={styles.searchResultActions}>
                <Pressable
                  onPress={async () => {
                    if (searchDestPinned) return;
                    await addPinnedRoute({ destName: searchDestinationName.split(",")[0], destLat: lastSearchGeo.lat, destLng: lastSearchGeo.lng });
                    setPinnedRoutes(await getPinnedRoutes());
                    setSearchDestPinned(true);
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    {searchDestPinned && <MapPin size={12} color={theme.colors.textSecondary} />}
                    <Text style={styles.pinBtn}>{searchDestPinned ? "Pinned" : "Pin"}</Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    if (searchDestSaved) return;
                    const name = searchDestinationName.split(",")[0];
                    await addFavoritePlace({ name, lat: lastSearchGeo.lat, lng: lastSearchGeo.lng });
                    setSearchDestSaved(true);
                    setSavedPlaceNames((prev) => new Set([...prev, name]));
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Star size={12} color={theme.colors.orange} fill={searchDestSaved ? theme.colors.orange : "none"} />
                    <Text style={styles.saveFavBtn}>{searchDestSaved ? "Saved" : "Save"}</Text>
                  </View>
                </Pressable>
              </View>
            )}
          </View>
          {/* Sort toggle */}
          <View style={[styles.sortRow, { paddingHorizontal: theme.spacing.lg }]}>
            {(['earliest', 'fastest', 'least-walk'] as const).map((s) => {
              const labels = { earliest: 'Arrives first', fastest: 'Fastest', 'least-walk': 'Fewest steps' };
              const active = routeSort === s;
              return (
                <Pressable
                  key={s}
                  style={[styles.sortPill, active && styles.sortPillActive]}
                  onPress={() => setRouteSort(s)}
                >
                  <Text style={[styles.sortPillText, active && styles.sortPillTextActive]}>{labels[s]}</Text>
                </Pressable>
              );
            })}
          </View>
          {sortedOptions(searchResults).map((opt, index) => {
            const isWalk = opt.type === "WALK";
            return renderOptionCard(
              opt,
              index,
              `search-${index}`,
              false,
              () => (isWalk ? onStartWalk(opt, searchDestinationName?.split(",")[0]) : onStartBus(opt)),
              searchDestinationName?.split(",")[0] ?? "destination"
            );
          })}
          {/* Smart callouts for search results */}
          {(() => {
            const walkOpt = searchResults.find((o) => o.type === 'WALK');
            const busOpts = searchResults.filter((o) => o.type !== 'WALK');
            const busBestEta = busOpts.length > 0 ? Math.min(...busOpts.map((o) => o.eta_minutes)) : null;
            if (walkOpt && busBestEta !== null && walkOpt.eta_minutes <= busBestEta + 4) {
              return (
                <Text style={styles.smartCallout}>Walking is almost as fast — and you'll get your steps</Text>
              );
            }
            return null;
          })()}
        </View>
      )}

      {/* Leave By Smart Card */}
      {leaveBy.nextClass && leaveBy.options.length > 0 && (
        <View style={styles.leaveByCard}>
          <View style={styles.leaveByHeader}>
            <Text style={styles.leaveByTitle}>{leaveBy.nextClass.title}</Text>
            <Text style={styles.leaveByTime}>{leaveBy.nextClass.start_time_local}</Text>
          </View>
          {leaveBy.options.slice(0, 2).map((opt, i) => (
            <View key={i} style={styles.leaveByRow}>
              <View style={[styles.leaveByStatusPill, { backgroundColor: opt.status === 'on-time' ? theme.colors.success : opt.status === 'tight' ? theme.colors.warning : theme.colors.error }]}>
                <Text style={styles.leaveByStatusText}>{opt.status === 'on-time' ? 'ON TIME' : opt.status === 'tight' ? 'TIGHT' : 'LATE'}</Text>
              </View>
              <Text style={styles.leaveByRouteText}>Route {opt.routeId}</Text>
              <Text style={styles.leaveBySummary}>Leave in {Math.max(0, Math.round((opt.departureEpochMs - Date.now()) / 60000))} min · {opt.totalTimeMins} min total</Text>
            </View>
          ))}
          {leaveBy.noViableBus && leaveBy.walkOnlyMins != null && (
            <Text style={styles.leaveByWalkFallback}>No bus on time — walk {leaveBy.walkOnlyMins} min</Text>
          )}
        </View>
      )}

      {/* Running late? trigger */}
      {leaveBy.nextClass && leaveBy.options.some((o) => o.marginMins < 10) && (
        <Pressable
          style={styles.runningLatePill}
          onPress={() => router.push('/running-late')}
          accessibilityLabel="Running late? See catchable buses"
          accessibilityRole="button"
        >
          <Text style={styles.runningLatePillText}>Running late?</Text>
        </Pressable>
      )}

      {/* Leave Now Banner */}
      {leaveNowBanner && (
        <View style={styles.leaveNowBanner}>
          <View style={styles.leaveNowLeft}>
            <Text style={styles.leaveNowTitle}>
              {buildLeaveNowBody(leaveNowBanner.option, leaveNowBanner.classTitle).title}
            </Text>
            <Text style={styles.leaveNowBody} numberOfLines={1}>
              {buildLeaveNowBody(leaveNowBanner.option, leaveNowBanner.classTitle).body}
            </Text>
          </View>
          <Pressable
            style={styles.leaveNowStartBtn}
            onPress={() => {
              setLeaveNowBanner(null);
              if (leaveNowBanner.option.type === "WALK") onStartWalk(leaveNowBanner.option);
              else onStartBus(leaveNowBanner.option);
            }}
          >
            <Text style={styles.leaveNowStartBtnText}>Start</Text>
          </Pressable>
          <Pressable style={styles.leaveNowDismiss} onPress={() => setLeaveNowBanner(null)}>
            <X size={16} color="rgba(255,255,255,0.75)" />
          </Pressable>
        </View>
      )}

      {/* Next up card */}
      <View style={styles.nextUpCard}>
        <View style={styles.nextUpLabelRow}>
          <Text style={styles.nextUpLabel}>Next up</Text>
          <NextUpArrow />
        </View>
        {nextUp ? (
          <>
            <Text style={styles.nextUpText}>{nextUp.title}</Text>
            <Text style={styles.nextUpTime}>{nextUp.start_time_local}</Text>
            <Pressable style={styles.walkingToClassBtn} onPress={onWalkingToClass}>
              <Text style={styles.walkingToClassBtnText}>I'm walking to this class</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.nextUpText}>No more classes today.</Text>
            <Pressable
              style={styles.planEveningBtn}
              onPress={() => router.push("/after-class-planner")}
            >
              <Text style={styles.planEveningBtnText}>Plan my evening →</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Activity row */}
      {nextUp && recommendations.length > 0 && (
        <View style={styles.activityRow}>
          <Text style={styles.activityLabel}>Activity</Text>
          <Text style={styles.activityText}>
            ~{sumWalkingMinutes(recommendations[0].steps)} min walking (this trip)
          </Text>
        </View>
      )}

      {nextUp && recommendations.length === 0 && (
        <View style={styles.recommendationsUnavailable}>
          <Text style={styles.recommendationsUnavailableText}>
            Route options unavailable. Pull down to refresh.
          </Text>
        </View>
      )}

      {/* After-last-class recommendations */}
      {!nextUp && afterLastClassPlace && afterLastClassRecs.length > 0 && (
        <View style={styles.recommendationsSection}>
          <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
            <Text style={[styles.sectionTitle, { marginBottom: 0, paddingHorizontal: 0, paddingTop: 0 }]}>Where to next?</Text>
            <Text style={styles.sectionSubtitle}>{afterLastClassPlace.name}</Text>
          </View>
          {afterLastClassRecs.map((opt, index) => {
            const isWalk = opt.type === "WALK";
            return renderOptionCard(
              opt,
              index,
              `after-${index}`,
              false,
              () => (isWalk ? onStartWalk(opt) : onStartBus(opt)),
              afterLastClassPlace?.name ?? "destination"
            );
          })}
        </View>
      )}

      {/* Class recommendations */}
      {nextUp && recommendations.length > 0 && (
        <View
          style={styles.recommendationsSection}
          onLayout={(e: LayoutChangeEvent) => {
            recommendationsY.current = e.nativeEvent.layout.y;
          }}
        >
          <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
            <Text style={[styles.sectionTitle, { marginBottom: 0, paddingHorizontal: 0, paddingTop: 0 }]}>Get there</Text>
            <Text style={styles.sectionSubtitle}>{nextUp.title}</Text>
          </View>
          {/* Sort toggle for class recommendations */}
          <View style={[styles.sortRow, { paddingHorizontal: theme.spacing.lg }]}>
            {(['earliest', 'fastest', 'least-walk'] as const).map((s) => {
              const labels = { earliest: 'Arrives first', fastest: 'Fastest', 'least-walk': 'Fewest steps' };
              const active = routeSort === s;
              return (
                <Pressable
                  key={s}
                  style={[styles.sortPill, active && styles.sortPillActive]}
                  onPress={() => setRouteSort(s)}
                >
                  <Text style={[styles.sortPillText, active && styles.sortPillTextActive]}>{labels[s]}</Text>
                </Pressable>
              );
            })}
          </View>
          {sortedOptions(recommendations).map((opt, index) => {
            const isWalk = opt.type === "WALK";
            const allBusLate = recommendations.filter((o) => o.type !== 'WALK').every((o) => optionStatus(o, nextUp?.start_time_local) === 'late');
            const highlighted = (isWalk && highlightWalk) || (isWalk && allBusLate);
            return renderOptionCard(
              opt,
              index,
              `rec-${index}`,
              highlighted,
              () => (isWalk ? onStartWalk(opt) : onStartBus(opt)),
              nextUp?.title ?? "class",
              nextUp?.start_time_local
            );
          })}
          {/* Smart callouts for class recommendations */}
          {(() => {
            const walkOpt = recommendations.find((o) => o.type === 'WALK');
            const busOpts = recommendations.filter((o) => o.type !== 'WALK');
            const busBestEta = busOpts.length > 0 ? Math.min(...busOpts.map((o) => o.eta_minutes)) : null;
            const allBusLate = busOpts.length > 0 && busOpts.every((o) => optionStatus(o, nextUp?.start_time_local) === 'late');
            const callouts: JSX.Element[] = [];
            if (walkOpt && busBestEta !== null && walkOpt.eta_minutes <= busBestEta + 4) {
              callouts.push(
                <Text key="walk-callout" style={styles.smartCallout}>
                  Walking is almost as fast — and you'll get your steps
                </Text>
              );
            }
            if (nextUp?.start_time_local && busOpts.length > 0) {
              const now = new Date();
              const nowMins = now.getHours() * 60 + now.getMinutes();
              const [ch, cm] = nextUp.start_time_local.split(':').map(Number);
              const classMins = (ch ?? 0) * 60 + (cm ?? 0);
              const bestBus = busOpts.reduce((a, b) => a.eta_minutes < b.eta_minutes ? a : b);
              const arrivalMins = nowMins + bestBus.depart_in_minutes + bestBus.eta_minutes;
              const margin = classMins - arrivalMins;
              const destContainsClass = searchDestinationName
                ? nextUp.title.toLowerCase().split(' ').some((w) => w.length > 3 && searchDestinationName.toLowerCase().includes(w))
                : false;
              if (destContainsClass && margin > 0) {
                callouts.push(
                  <Text key="class-callout" style={[styles.smartCallout, styles.smartCalloutGreen]}>
                    Gets you to {nextUp.title} with {Math.round(margin)} min to spare
                  </Text>
                );
              }
            }
            if (allBusLate && walkOpt) {
              callouts.push(
                <Text key="late-callout" style={styles.smartCallout}>
                  All buses are late — walking may be your best bet
                </Text>
              );
            }
            return callouts.length > 0 ? <>{callouts}</> : null;
          })()}
        </View>
      )}

      {/* Nearby stops */}
      <Text style={styles.stopsSectionTitle}>Nearby stops</Text>
      {stops.length > 0 && Object.keys(departuresByStop).every((id) => (departuresByStop[id]?.length ?? 0) === 0) && (
        <View style={styles.mtdHint}>
          <Text style={styles.mtdHintText}>Live bus times need MTD_API_KEY on the server. Set it in the backend .env to see departures.</Text>
        </View>
      )}
      {stops.length === 0 ? (
        <Text style={styles.empty}>No nearby stops in range.</Text>
      ) : (
        stops.map((stop) => (
          <View key={stop.stop_id} style={styles.card}>
            <View style={styles.stopCardHeader}>
              <Text style={styles.stopName}>{stop.stop_name}</Text>
              <Pressable
                style={styles.favoriteStopBtn}
                onPress={() => addFavoriteStop({ stop_id: stop.stop_id, stop_name: stop.stop_name })}
              >
                <Star size={16} color={theme.colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.distance}>{formatDistance(stop.distance_m)} away</Text>
            <View style={styles.departures}>
              {(departuresByStop[stop.stop_id] ?? []).length === 0 ? (
                <Text style={styles.depText}>No departures</Text>
              ) : (
                (departuresByStop[stop.stop_id] ?? []).map((d, i) => (
                  <View key={i} style={styles.depRow}>
                    <Pressable
                      onPress={() => router.push({ pathname: "/route-tracker", params: { route_id: d.route, route_name: d.headsign } })}
                      accessibilityLabel={`Track route ${d.route}`}
                    >
                      <View style={styles.depRouteBadge}>
                        <Text style={styles.depRouteBadgeText}>{d.route}</Text>
                      </View>
                    </Pressable>
                    <Text style={styles.depHeadsign} numberOfLines={1}>{d.headsign || "—"}</Text>
                    <Text style={styles.depCountdown}>{d.expected_mins} min</Text>
                    {d.is_realtime && <LiveBadge />}
                  </View>
                ))
              )}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: theme.colors.surfaceAlt,
  },
  centeredText: { marginTop: 12, fontFamily: "DMSans_400Regular", fontSize: 15, color: theme.colors.textSecondary },
  scrollContent: { paddingBottom: 32, backgroundColor: theme.colors.surfaceAlt },
  greeting: { fontSize: 22, fontFamily: "DMSerifDisplay_400Regular", color: theme.colors.navy, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.sm, backgroundColor: theme.colors.surface },

  // Search card
  searchCard: {
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    padding: theme.spacing.lg,
    marginBottom: 0,
  },
  searchLabel: { fontFamily: "DMSans_600SemiBold", fontSize: 11, letterSpacing: 0.8, color: theme.colors.textMuted, marginBottom: 8, textTransform: "uppercase" as const },
  searchInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.lg,
    height: 52,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  searchInput: {
    flex: 1,
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    color: theme.colors.text,
  },
  searchBtn: {
    backgroundColor: theme.colors.orange,
    paddingVertical: 11,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  searchBtnDisabled: { opacity: 0.7 },
  searchBtnText: { color: "#fff", fontFamily: "DMSans_600SemiBold", fontSize: 16 },
  searchError: { color: theme.colors.error, fontFamily: "DMSans_400Regular", fontSize: 13, marginTop: 8 },

  // Next up card
  nextUpLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  nextUpCard: {
    backgroundColor: "#FFF8F6",
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.orange,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing.md,
    paddingRight: theme.spacing.lg,
    paddingLeft: theme.spacing.lg - 3,
    marginBottom: 0,
  },
  nextUpLabel: { fontFamily: "DMSans_600SemiBold", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" as const, color: theme.colors.orange },
  nextUpText: { fontFamily: "DMSans_700Bold", fontSize: 17, color: theme.colors.navy },
  nextUpTime: { fontFamily: "DMSans_500Medium", fontSize: 14, color: theme.colors.textSecondary, marginTop: 1 },
  walkingToClassBtn: { marginTop: 8, alignSelf: "flex-start" },
  walkingToClassBtnText: { fontFamily: "DMSans_600SemiBold", fontSize: 13, color: theme.colors.orange },

  // Activity row
  activityRow: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  activityLabel: { fontFamily: "DMSans_600SemiBold", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" as const, color: theme.colors.textMuted },
  activityText: { fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.colors.textSecondary },

  // Recommendations section
  recommendationsSection: { marginBottom: 0 },
  sectionTitle: { fontFamily: "DMSans_700Bold", fontSize: 17, color: theme.colors.navy, marginBottom: 4, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg },
  sectionSubtitle: { fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.colors.textMuted, paddingHorizontal: theme.spacing.lg, marginBottom: 10 },

  // Option card — redesigned
  optionCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    marginTop: 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 3,
    padding: theme.spacing.md,
  },
  optionCardHighlight: { borderColor: theme.colors.orange },

  // Card top row: badge + departure time
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  cardTypeBadge: {
    borderRadius: theme.radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cardTypeBadgeWalk: { backgroundColor: theme.colors.navy },
  cardTypeBadgeBus: { backgroundColor: theme.colors.navy },
  cardTypeBadgeText: { fontFamily: "DMSans_700Bold", fontSize: 11, color: "#fff", letterSpacing: 0.5 },
  cardDepartTime: { fontFamily: "DMSans_700Bold", fontSize: 22, color: theme.colors.orange },
  cardDepartNow: { fontFamily: "DMSans_700Bold", fontSize: 22, color: theme.colors.success },

  // Step flow
  stepFlowText: { fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.colors.textMuted, marginBottom: 8 },

  // AI explanation
  aiExplanation: { fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.colors.orange, fontStyle: "italic", marginBottom: 6 },

  // Card bottom row: total time + inline start button
  cardBottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  cardTotalTime: { fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.colors.textSecondary },
  startBtnInline: {
    backgroundColor: theme.colors.orange,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  startBtnInlineText: { fontFamily: "DMSans_600SemiBold", fontSize: 14, color: "#fff" },

  // MTD hint
  mtdHint: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
  },
  mtdHintText: { fontSize: 13, color: theme.colors.textSecondary },

  // Stops section
  stopsSectionTitle: { fontFamily: "DMSans_600SemiBold", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" as const, color: theme.colors.textMuted, marginBottom: 0, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  card: {
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.orange,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    marginBottom: 0,
  },
  stopCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stopName: { fontFamily: "DMSans_600SemiBold", fontSize: 15, color: theme.colors.navy, flex: 1 },
  favoriteStopBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  favoriteStopBtnText: { fontFamily: "DMSans_500Medium", fontSize: 16, color: theme.colors.textMuted },
  distance: { fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.colors.textMuted, marginTop: 1, marginBottom: 6 },
  departures: { gap: 4 },
  depRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3 },
  depRouteBadge: {
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 32,
    alignItems: "center",
  },
  depRouteBadgeText: { fontFamily: "DMSans_700Bold", fontSize: 11, color: "#fff" },
  depHeadsign: { fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.colors.text, flex: 1 },
  depCountdown: { fontFamily: "DMSans_600SemiBold", fontSize: 13, color: theme.colors.textSecondary },
  depText: { fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.colors.textMuted },
  liveBadge: {
    backgroundColor: theme.colors.orange,
    borderRadius: theme.radius.xs,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  liveBadgeText: { fontFamily: "DMSans_600SemiBold", fontSize: 10, color: "#fff" },
  empty: { fontFamily: "DMSans_400Regular", fontSize: 15, color: theme.colors.textSecondary, textAlign: "center", marginTop: 24, padding: theme.spacing.lg },

  // Error / permission screens
  errorText: { fontFamily: "DMSans_600SemiBold", fontSize: 17, color: theme.colors.error },
  hint: { fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.colors.textSecondary, marginTop: 8, textAlign: "center" },
  retryBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.md,
  },
  retryBtnText: { fontFamily: "DMSans_600SemiBold", color: "#fff", fontSize: 15 },
  retryBtnSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.navy, marginTop: 8 },
  retryBtnSecondaryText: { fontFamily: "DMSans_600SemiBold", color: theme.colors.navy, fontSize: 15 },

  // Banners
  rainBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.navyLight,
    paddingVertical: 8,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rainBannerText: { fontFamily: "DMSans_400Regular", fontSize: 13, color: "rgba(255,255,255,0.9)", flex: 1 },
  rainBannerIcon: { fontSize: 18, color: "#fff", paddingLeft: 8 },

  uiucBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.navy,
  },
  uiucBannerText: { fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.colors.textSecondary, flex: 1 },
  uiucBannerLink: { fontFamily: "DMSans_600SemiBold", fontSize: 13, color: theme.colors.orange },
  offlineBanner: {
    backgroundColor: theme.colors.navy,
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  offlineBannerText: { fontFamily: "DMSans_400Regular", fontSize: 13, color: "#fff", flex: 1 },
  offlineBannerRetry: { fontFamily: "DMSans_600SemiBold", fontSize: 13, color: theme.colors.orange, paddingLeft: 8 },

  // Leave Now banner
  leaveNowBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.orange,
    paddingVertical: 12,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: 0,
  },
  leaveNowLeft: { flex: 1, marginRight: theme.spacing.sm },
  leaveNowTitle: { fontFamily: "DMSans_600SemiBold", fontSize: 15, color: "#fff", marginBottom: 2 },
  leaveNowBody: { fontFamily: "DMSans_400Regular", fontSize: 13, color: "rgba(255,255,255,0.88)" },
  leaveNowStartBtn: {
    backgroundColor: "#fff",
    borderRadius: theme.radius.sm,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  leaveNowStartBtnText: { fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.colors.orange },
  leaveNowDismiss: { padding: 8 },
  leaveNowDismissText: { fontFamily: "DMSans_600SemiBold", fontSize: 15, color: "rgba(255,255,255,0.75)" },

  // Leave By smart card
  leaveByCard: { backgroundColor: theme.colors.surface, borderLeftWidth: 4, borderLeftColor: theme.colors.navy, borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
  leaveByHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  leaveByTitle: { fontSize: 15, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy, flex: 1 },
  leaveByTime: { fontSize: 13, fontFamily: "DMSans_500Medium", color: theme.colors.textSecondary },
  leaveByRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  leaveByStatusPill: { borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
  leaveByStatusText: { fontSize: 10, fontFamily: "DMSans_700Bold", color: "#fff" },
  leaveByRouteText: { fontSize: 13, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy },
  leaveBySummary: { fontSize: 13, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, flex: 1 },
  leaveByWalkFallback: { fontSize: 13, fontFamily: "DMSans_400Regular", color: theme.colors.orange, marginTop: 4 },

  // Autocomplete
  suggestionsList: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 8,
    overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  suggestionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  suggestionText: { fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.colors.text, flex: 1 },
  suggestionType: { fontFamily: "DMSans_600SemiBold", fontSize: 10, color: theme.colors.navy, backgroundColor: theme.colors.surfaceAlt, paddingHorizontal: 5, paddingVertical: 1, borderRadius: theme.radius.xs, marginLeft: 6 },
  suggestionSub: { fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.colors.textMuted, marginTop: 1, paddingBottom: 2 },

  // Recent searches
  recentSearches: { marginTop: 8 },
  recentLabel: { fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.colors.textMuted, marginBottom: 4 },
  recentItem: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  recentItemText: { fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.colors.navy, flex: 1 },

  // Search results header
  searchResultsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, marginBottom: 4 },
  saveFavBtn: { fontFamily: "DMSans_600SemiBold", fontSize: 13, color: theme.colors.orange, paddingTop: 2 },

  // Plan evening
  planEveningBtn: { marginTop: 8, alignSelf: "flex-start" },
  planEveningBtnText: { fontFamily: "DMSans_600SemiBold", fontSize: 13, color: theme.colors.orange },

  // Recommendations unavailable
  recommendationsUnavailable: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    padding: 12,
    marginHorizontal: theme.spacing.lg,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  recommendationsUnavailableText: { fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.colors.textSecondary },

  // Option meta (kept for compatibility, not used in new card layout)
  optionMeta: { fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  optionCardTitle: { fontFamily: "DMSans_600SemiBold", fontSize: 15, color: theme.colors.navy },

  // Card actions row (share + start)
  cardActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  shareBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  shareBtnText: { fontFamily: "DMSans_600SemiBold", fontSize: 13, color: theme.colors.textSecondary },

  // Quick chips row (home + pinned)
  quickChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  homePlaceChip: {
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  homePlaceChipText: { fontFamily: "DMSans_600SemiBold", fontSize: 14, color: "#fff" },
  pinnedChip: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pinnedChipText: { fontFamily: "DMSans_500Medium", fontSize: 14, color: theme.colors.navy },

  // Search result action buttons
  searchResultActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  pinBtn: { fontFamily: "DMSans_600SemiBold", fontSize: 13, color: theme.colors.textSecondary },

  // Suggestion save button (star)
  suggestionMain: { flex: 1, paddingVertical: 10 },
  suggestionSaveBtn: { paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center" },
  suggestionSaveBtnText: { fontFamily: "DMSans_500Medium", fontSize: 18, color: theme.colors.orange },

  // F2: Sort pills
  sortRow: { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  sortPill: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 4, borderWidth: 1, borderColor: theme.colors.navy },
  sortPillActive: { backgroundColor: theme.colors.orange, borderColor: theme.colors.orange },
  sortPillText: { fontSize: 12, fontFamily: "DMSans_500Medium", color: theme.colors.navy },
  sortPillTextActive: { color: '#fff' },

  // F2: Status pill on option cards
  optionStatusPill: { borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1, marginRight: 4 },
  optionStatusText: { fontSize: 9, fontFamily: "DMSans_700Bold", color: '#fff' },

  // F2: MTD free caption
  mtdFree: { fontSize: 11, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted, marginTop: 2 },

  // F2: Smart callouts
  smartCallout: { fontSize: 13, fontFamily: "DMSans_400Regular", fontStyle: 'italic', color: theme.colors.orange, marginTop: 6, paddingHorizontal: theme.spacing.lg },
  smartCalloutGreen: { color: theme.colors.success },

  // F3: Running late pill trigger
  runningLatePill: {
    alignSelf: 'flex-start',
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.error,
    borderRadius: theme.radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  runningLatePillText: { fontFamily: "DMSans_700Bold", fontSize: 13, color: '#fff' },
});
