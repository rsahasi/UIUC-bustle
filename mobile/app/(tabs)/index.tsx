import { fetchAutocomplete, fetchBuildings, fetchClasses, fetchDepartures, fetchNearbyStops, fetchRecommendation } from "@/src/api/client";
import type { AutocompleteResult, Building } from "@/src/api/client";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useClassNotificationsEnabled } from "@/src/hooks/useClassNotificationsEnabled";
import { useRecommendationSettings } from "@/src/hooks/useRecommendationSettings";
import type { DepartureItem, RecommendationOption, RecommendationStep, StopInfo } from "@/src/api/types";
import { cancelClassReminder, cancelAllClassReminders, scheduleClassReminders } from "@/src/notifications/classReminders";
import { addFavoriteStop, addFavoritePlace, getAfterLastClassPlaceId, getFavoritePlaces, type SavedPlace } from "@/src/storage/favorites";
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
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { theme } from "@/src/constants/theme";

const TOP_STOPS = 3;
const NEXT_DEPARTURES = 3;
const UIUC_FALLBACK = { lat: 40.102, lng: -88.2272 };
const LIVE_REFRESH_MS = 30_000;

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

export default function HomeScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { enabled: classNotificationsEnabled } = useClassNotificationsEnabled();
  const { walkingModeId, walkingSpeedMps, bufferMinutes } = useRecommendationSettings();
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
  const scrollRef = useRef<ScrollView>(null);
  const recommendationsY = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep latest stops ref for live refresh without re-running location
  const stopsRef = useRef<StopWithDistance[]>([]);

  const nextUp = getNextClassToday(scheduleClasses);

  // Load recent searches on mount
  useEffect(() => {
    getRecentSearches().then(setRecentSearches);
  }, []);

  // Debounced combined autocomplete (buildings + Nominatim) as user types
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setAutocompleteSuggestions([]); return; }
    const timer = setTimeout(async () => {
      try {
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

        const [stopsData, classesData] = await Promise.all([
          fetchNearbyStops(apiBaseUrl, latitude, longitude, 800, { signal, apiKey: apiKey ?? undefined }),
          fetchClasses(apiBaseUrl, { signal, apiKey: apiKey ?? undefined }).catch(() => ({ classes: [] })),
        ]);
        if (signal?.aborted) return;
        setScheduleClasses(classesData.classes ?? []);
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
        const nextClass = getNextClassToday(classesData.classes ?? []);
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
              const arriveBy = new Date(Date.now() + 60 * 60 * 1000).toISOString();
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
          try {
            await cancelAllClassReminders();
            const buildingsRes = await fetchBuildings(apiBaseUrl, { signal, apiKey: apiKey ?? undefined }).catch(() => ({ buildings: [] }));
            const buildingMap: Record<string, string> = {};
            for (const b of buildingsRes.buildings ?? []) buildingMap[b.building_id] = b.name;
            await scheduleClassReminders(classesData.classes ?? [], buildingMap, walkingSpeedMps, bufferMinutes);
          } catch (_) {
            await scheduleClassReminders(classesData.classes ?? [], {}, walkingSpeedMps, bufferMinutes);
          }
        }

        setStatus("ready");
        await setLastKnownHomeData({
          stops: withDist,
          departuresByStop: depMap,
          scheduleClasses: classesData.classes ?? [],
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

    // Live departure refresh every 30 seconds
    liveIntervalRef.current = setInterval(() => {
      refreshDepartures();
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
  }, [load, refreshDepartures]);

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
    const step = opt.steps.find((s) => s.type === "WALK_TO_DEST");
    if (step?.building_lat != null && step?.building_lng != null) {
      router.push({
        pathname: "/walk-nav",
        params: {
          dest_lat: String(step.building_lat),
          dest_lng: String(step.building_lng),
          dest_name: destNameOverride ?? nextUp?.title ?? "Destination",
          walking_mode_id: walkingModeId,
        },
      });
    }
  }, [router, nextUp, walkingModeId]);

  const onStartBus = useCallback(
    (opt: RecommendationOption) => {
      // Walk to the bus stop using the internal walk-nav map (no app switching)
      const step = opt.steps.find((s) => s.type === "WALK_TO_STOP");
      const rideStep = opt.steps.find((s) => s.type === "RIDE");
      const routeId = rideStep?.route ?? "";
      const alightingStopId = rideStep?.alighting_stop_id ?? "";
      const alightingLat = rideStep?.alighting_stop_lat ?? null;
      const alightingLng = rideStep?.alighting_stop_lng ?? null;
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
          },
        });
      }
    },
    [router, walkingModeId]
  );

  const onWalkingToClass = useCallback(async () => {
    if (!nextUp) return;
    await markClassAsWalkedToday(nextUp.class_id);
    await cancelClassReminder(nextUp.class_id);
  }, [nextUp]);

  /** Shared recommendation fetch used by both search paths. */
  const _fetchRoutesTo = useCallback(async (destLat: number, destLng: number, destName: string, queryLabel: string) => {
    if (!location) return;
    const arriveBy = new Date(Date.now() + 60 * 60 * 1000).toISOString();
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

  /** Tap any autocomplete suggestion (building or place) — immediately loads routes. */
  const onSelectSuggestion = useCallback(async (item: AutocompleteResult) => {
    const displayName = item.display_name?.split(",")[0]?.trim() || item.name;
    setSearchQuery(displayName);
    setAutocompleteSuggestions([]);
    setSearchError(null);
    setSearchResults([]);
    setSearchDestinationName(null);
    setSearchLoading(true);
    try {
      await _fetchRoutesTo(item.lat, item.lng, item.display_name || item.name, displayName);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [_fetchRoutesTo]);

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
        <ActivityIndicator size="large" color="#13294b" />
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

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#13294b" />
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
      <View style={styles.searchCard}>
        <Text style={styles.searchLabel}>Where to?</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="e.g. Siebel, Illini Union, or an address"
          placeholderTextColor={theme.colors.textMuted}
          value={searchQuery}
          onChangeText={(t) => { setSearchQuery(t); setSearchError(null); if (!t.trim()) setAutocompleteSuggestions([]); }}
          onSubmitEditing={onSearchDestination}
          editable={!searchLoading}
        />
        {autocompleteSuggestions.length > 0 && (
          <View style={styles.suggestionsList}>
            {autocompleteSuggestions.map((item, i) => (
              <Pressable
                key={`${item.type}-${i}`}
                style={styles.suggestionItem}
                onPress={() => onSelectSuggestion(item)}
              >
                <View style={styles.suggestionRow}>
                  <Text style={styles.suggestionText} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.type === "place" && (
                    <Text style={styles.suggestionType}>📍</Text>
                  )}
                </View>
                {item.display_name && item.display_name !== item.name && (
                  <Text style={styles.suggestionSub} numberOfLines={1}>
                    {item.display_name.split(",").slice(1, 3).join(",").trim()}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        )}
        <Pressable
          style={[styles.searchBtn, searchLoading && styles.searchBtnDisabled]}
          onPress={onSearchDestination}
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
                <Text style={styles.recentItemText}>{r.displayName.split(",")[0]}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      {searchDestinationName && searchResults.length > 0 && (
        <View style={styles.recommendationsSection}>
          <View style={styles.searchResultsHeader}>
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Routes to {searchDestinationName.split(",")[0]}</Text>
            {lastSearchGeo && (
              <Pressable
                onPress={async () => {
                  await addFavoritePlace({ name: searchDestinationName.split(",")[0], lat: lastSearchGeo.lat, lng: lastSearchGeo.lng });
                }}
              >
                <Text style={styles.saveFavBtn}>☆ Save</Text>
              </Pressable>
            )}
          </View>
          {searchResults.map((opt, index) => {
            const title = optionCardTitle(index, opt);
            const isWalk = opt.type === "WALK";
            return (
              <View key={`search-${index}`} style={styles.optionCard}>
                <Text style={styles.optionCardTitle}>{title}</Text>
                <Text style={styles.optionMeta}>
                  Leave in {opt.depart_in_minutes} min · {opt.eta_minutes} min total
                </Text>
                <View style={styles.stepList}>
                  {opt.steps.slice(0, 4).map((s, i) => {
                    let line = "";
                    if (s.type === "WALK_TO_STOP") line = `Walk to ${s.stop_name ?? s.stop_id}`;
                    else if (s.type === "WAIT") line = `Wait ${s.duration_minutes} min`;
                    else if (s.type === "RIDE") line = `Bus ${s.route ?? ""} ${s.headsign ?? ""}`.trim();
                    else if (s.type === "WALK_TO_DEST") line = "Walk to destination";
                    if (s.duration_minutes != null && s.duration_minutes > 0) line += ` (${s.duration_minutes} min)`;
                    return <Text key={i} style={styles.stepLine}>{line}</Text>;
                  })}
                </View>
                <Pressable style={styles.startBtn} onPress={() => (isWalk ? onStartWalk(opt, searchDestinationName?.split(",")[0]) : onStartBus(opt))}>
                  <Text style={styles.startBtnText}>Start</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
      <View style={styles.nextUpCard}>
        <Text style={styles.nextUpLabel}>Next up:</Text>
        {nextUp ? (
          <>
            <Text style={styles.nextUpText}>
              {nextUp.title} at {nextUp.start_time_local}
            </Text>
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

      {!nextUp && afterLastClassPlace && afterLastClassRecs.length > 0 && (
        <View style={styles.recommendationsSection}>
          <Text style={styles.sectionTitle}>Where to next? {afterLastClassPlace.name}</Text>
          {afterLastClassRecs.map((opt, index) => {
            const title = optionCardTitle(index, opt);
            const isWalk = opt.type === "WALK";
            return (
              <View key={index} style={styles.optionCard}>
                <Text style={styles.optionCardTitle}>{title}</Text>
                <Text style={styles.optionMeta}>
                  Leave in {opt.depart_in_minutes} min · {opt.eta_minutes} min total
                </Text>
                <View style={styles.stepList}>
                  {opt.steps.slice(0, 4).map((s, i) => {
                    let line = "";
                    if (s.type === "WALK_TO_STOP") line = `Walk to ${s.stop_name ?? s.stop_id}`;
                    else if (s.type === "WAIT") line = `Wait ${s.duration_minutes} min`;
                    else if (s.type === "RIDE") line = `Bus ${s.route ?? ""} ${s.headsign ?? ""}`.trim();
                    else if (s.type === "WALK_TO_DEST") line = `Walk to ${afterLastClassPlace.name}`;
                    if (s.duration_minutes != null && s.duration_minutes > 0) line += ` (${s.duration_minutes} min)`;
                    return <Text key={i} style={styles.stepLine}>{line}</Text>;
                  })}
                </View>
                <Pressable
                  style={styles.startBtn}
                  onPress={() => (isWalk ? onStartWalk(opt) : onStartBus(opt))}
                >
                  <Text style={styles.startBtnText}>Start</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {nextUp && recommendations.length > 0 && (
        <View
          style={styles.recommendationsSection}
          onLayout={(e: LayoutChangeEvent) => {
            recommendationsY.current = e.nativeEvent.layout.y;
          }}
        >
          <Text style={styles.sectionTitle}>Get there</Text>
          {recommendations.map((opt, index) => {
            const title = optionCardTitle(index, opt);
            const isWalk = opt.type === "WALK";
            const highlighted = isWalk && highlightWalk;
            return (
              <View
                key={index}
                style={[styles.optionCard, highlighted && styles.optionCardHighlight]}
              >
                <Text style={styles.optionCardTitle}>{title}</Text>
                <Text style={styles.optionMeta}>
                  Leave in {opt.depart_in_minutes} min · {opt.eta_minutes} min total
                </Text>
                {opt.ai_explanation && (
                  <Text style={styles.aiExplanation}>Claude suggests: {opt.ai_explanation}</Text>
                )}
                <View style={styles.stepList}>
                  {opt.steps.slice(0, 4).map((s, i) => {
                    let line = "";
                    if (s.type === "WALK_TO_STOP") line = `Walk to ${s.stop_name ?? s.stop_id}`;
                    else if (s.type === "WAIT") line = `Wait ${s.duration_minutes} min`;
                    else if (s.type === "RIDE") line = `Bus ${s.route ?? ""} ${s.headsign ?? ""}`.trim();
                    else if (s.type === "WALK_TO_DEST") line = "Walk to building";
                    if (s.duration_minutes != null && s.duration_minutes > 0) line += ` (${s.duration_minutes} min)`;
                    return (
                      <Text key={i} style={styles.stepLine}>
                        {line}
                      </Text>
                    );
                  })}
                </View>
                <Pressable
                  accessibilityLabel={isWalk ? "Start walking directions" : "Start bus option"}
                  accessibilityRole="button"
                  style={styles.startBtn}
                  onPress={() => (isWalk ? onStartWalk(opt) : onStartBus(opt))}
                >
                  <Text style={styles.startBtnText}>Start</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

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
                <Text style={styles.favoriteStopBtnText}>☆ Favorite</Text>
              </Pressable>
            </View>
            <Text style={styles.distance}>{formatDistance(stop.distance_m)} away</Text>
            <View style={styles.departures}>
              {(departuresByStop[stop.stop_id] ?? []).length === 0 ? (
                <Text style={styles.depText}>No departures</Text>
              ) : (
                (departuresByStop[stop.stop_id] ?? []).map((d, i) => (
                  <View key={i} style={styles.depRow}>
                    <Text style={styles.depText}>
                      {d.route} → {d.headsign || "—"} · {d.expected_mins} min
                    </Text>
                    {d.is_realtime && (
                      <View style={styles.liveBadge}>
                        <Text style={styles.liveBadgeText}>Live</Text>
                      </View>
                    )}
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
    backgroundColor: "#fff",
  },
  centeredText: { marginTop: 12, fontSize: 16, color: "#666" },
  scrollContent: { padding: 16, paddingBottom: 32 },
  searchCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  searchLabel: { ...theme.typography.label, color: theme.colors.primary, marginBottom: 8 },
  searchInput: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    padding: 12,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  searchBtn: {
    backgroundColor: theme.colors.secondary,
    padding: 14,
    borderRadius: theme.radius.sm,
    alignItems: "center",
  },
  searchBtnDisabled: { opacity: 0.7 },
  searchBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  searchError: { color: theme.colors.error, fontSize: 14, marginTop: 8 },
  nextUpCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  nextUpLabel: { ...theme.typography.label, color: theme.colors.primary, marginBottom: 4 },
  nextUpText: { fontSize: 16, color: theme.colors.text },
  walkingToClassBtn: { marginTop: 10, alignSelf: "flex-start" },
  walkingToClassBtnText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
  activityRow: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 12,
    marginBottom: 16,
  },
  activityLabel: { ...theme.typography.label, color: theme.colors.primary, marginBottom: 4 },
  activityText: { fontSize: 14, color: theme.colors.textSecondary },
  recommendationsSection: { marginBottom: 24 },
  sectionTitle: { ...theme.typography.heading, color: theme.colors.primary, marginBottom: 12 },
  optionCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  optionCardHighlight: { borderWidth: 2, borderColor: theme.colors.secondary },
  optionCardTitle: { ...theme.typography.heading, color: theme.colors.primary },
  optionMeta: { fontSize: 14, color: theme.colors.textSecondary, marginTop: 4 },
  aiExplanation: { fontSize: 12, color: theme.colors.secondary, fontStyle: "italic", marginTop: 4 },
  stepList: { marginTop: 10 },
  stepLine: { fontSize: 13, color: theme.colors.text, marginTop: 4 },
  startBtn: {
    marginTop: 14,
    backgroundColor: theme.colors.primary,
    padding: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  startBtnText: { fontSize: 18, fontWeight: "700", color: "#fff" },
  mtdHint: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
  },
  mtdHintText: { fontSize: 13, color: theme.colors.textSecondary },
  stopsSectionTitle: { ...theme.typography.heading, color: theme.colors.primary, marginBottom: 12 },
  card: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  stopCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  stopName: { fontSize: 18, fontWeight: "600", color: "#13294b", flex: 1 },
  favoriteStopBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  favoriteStopBtnText: { fontSize: 13, color: "#13294b", fontWeight: "500" },
  distance: { fontSize: 14, color: "#666", marginTop: 4 },
  departures: { marginTop: 10 },
  depRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 8 },
  depText: { fontSize: 14, color: "#333" },
  liveBadge: {
    backgroundColor: "#2e7d32",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  liveBadgeText: { fontSize: 10, color: "#fff", fontWeight: "700" },
  empty: { fontSize: 16, color: "#666", textAlign: "center", marginTop: 24 },
  errorText: { fontSize: 18, fontWeight: "600", color: "#c41e3a" },
  hint: { fontSize: 14, color: "#666", marginTop: 8, textAlign: "center" },
  retryBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "#13294b",
    borderRadius: 8,
  },
  retryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  retryBtnSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.primary, marginTop: 8 },
  retryBtnSecondaryText: { color: theme.colors.primary, fontSize: 16, fontWeight: "600" },
  uiucBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.surface,
    padding: 10,
    marginBottom: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.primary,
  },
  uiucBannerText: { fontSize: 14, color: theme.colors.textSecondary, flex: 1 },
  uiucBannerLink: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
  recommendationsUnavailable: {
    backgroundColor: "#fff8e6",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  recommendationsUnavailableText: { fontSize: 14, color: "#666" },
  offlineBanner: {
    backgroundColor: theme.colors.warning,
    padding: 10,
    marginBottom: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  offlineBannerText: { fontSize: 14, color: theme.colors.text, flex: 1 },
  offlineBannerRetry: { fontSize: 14, color: theme.colors.primary, fontWeight: "700", paddingLeft: 8 },
  suggestionsList: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    marginBottom: 8,
    overflow: "hidden",
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.cardBorder,
  },
  suggestionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  suggestionText: { fontSize: 14, color: theme.colors.text, flex: 1 },
  suggestionType: { fontSize: 12, marginLeft: 6 },
  suggestionSub: { fontSize: 12, color: theme.colors.textMuted, marginTop: 1 },
  recentSearches: { marginTop: 8 },
  recentLabel: { fontSize: 12, color: theme.colors.textMuted, marginBottom: 4 },
  recentItem: { paddingVertical: 4 },
  recentItemText: { fontSize: 14, color: theme.colors.primary },
  searchResultsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  saveFavBtn: { fontSize: 13, color: theme.colors.secondary, fontWeight: "600" },
  planEveningBtn: { marginTop: 10, alignSelf: "flex-start" },
  planEveningBtnText: { fontSize: 14, color: theme.colors.secondary, fontWeight: "600" },
});
