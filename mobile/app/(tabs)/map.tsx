import { fetchAutocomplete, fetchBusRouteStops, fetchPlaceDetails, fetchRecommendation, fetchWalkingRoute, fetchCrowding } from "@/src/api/client";
import type { AutocompleteResult } from "@/src/api/client";
import type { RecommendationOption, StopInfo, CrowdingInfo } from "@/src/api/types";
import { CrowdingSheet } from "@/src/components/CrowdingSheet";
import { CROWDING_ICONS, crowdingLabel } from "@/src/utils/crowding";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useRecommendationSettings } from "@/src/hooks/useRecommendationSettings";
import { formatDistance, haversineMeters } from "@/src/utils/distance";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAnalytics } from "@/src/hooks/useAnalytics";
import React from "react";
import { useVehicles } from "@/src/queries/map";
import { useDepartures, useNearbyStops } from "@/src/queries/departures";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "@/src/constants/theme";
import { FadeInView, PressableScale, Skeleton } from "@/src/components/ui/motion";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { DepartureRow } from "@/src/components/ui/DepartureRow";
import { Bus, Footprints, MapPin, Search, X } from "lucide-react-native";

/** Live vehicles chip — the shared Badge pairs its breathing dot with text and respects reduce-motion. */
function MapLiveBadge({ count }: { count: number }) {
  return <Badge label={`LIVE · ${count} ${count === 1 ? "bus" : "buses"}`} variant="live" size="md" />;
}

/** AA crowding accent from theme tokens — same vocabulary as CrowdingBadge. */
function crowdThemeColor(info: CrowdingInfo | null | undefined): string {
  if (!info || info.source === "estimated") return theme.colors.crowd.estimated;
  return theme.colors.crowd[info.level] ?? theme.colors.crowd.estimated;
}

/** Render-only vehicle marker face: orange bus dot, heading wedge, crowding ring + glyph bubble. */
function VehicleDot({ ringColor, headingDeg, glyph }: { ringColor: string; headingDeg: number | null; glyph: string | null }) {
  return (
    <View style={markerStyles.vehicleWrap}>
      {headingDeg != null && (
        <View style={[markerStyles.headingLayer, { transform: [{ rotate: `${headingDeg}deg` }] }]}>
          <View style={markerStyles.headingWedge} />
        </View>
      )}
      <View style={[markerStyles.vehicleDot, { borderColor: ringColor }]}>
        <View style={markerStyles.vehicleCore} />
      </View>
      {glyph != null && (
        <View style={markerStyles.crowdBubble}>
          <Text style={markerStyles.crowdGlyph}>{glyph}</Text>
        </View>
      )}
    </View>
  );
}

/** Render-only stop marker: a quiet navy dot that grows (with an orange core) when selected. */
function StopDot({ selected }: { selected: boolean }) {
  return selected ? (
    <View style={markerStyles.stopSelectedOuter}>
      <View style={markerStyles.stopSelectedInner} />
    </View>
  ) : (
    <View style={markerStyles.stopIdle} />
  );
}

const INITIAL_DELTA = 0.008;
const UIUC_FALLBACK = { lat: 40.1020, lng: -88.2272 };

type StopWithDistance = StopInfo & { distance_m: number };

export default function MapScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { walkingModeId, walkingSpeedMps, bufferMinutes } = useRecommendationSettings();
  const router = useRouter();
  const { capture } = useAnalytics();

  useFocusEffect(
    useCallback(() => {
      capture("map_viewed");
    }, [capture])
  );
  const [status, setStatus] = useState<"loading" | "denied" | "error" | "ready">("loading");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(UIUC_FALLBACK);
  const [selectedStop, setSelectedStop] = useState<StopWithDistance | null>(null);
  const [useUiucArea, setUseUiucArea] = useState(false);

  // TanStack Query: vehicles (15s polling)
  const { data: vehiclesData } = useVehicles();
  const vehicles = vehiclesData?.vehicles ?? [];

  // TanStack Query: nearby stops (reactive on location)
  const { data: nearbyStopsData } = useNearbyStops(
    location?.lat ?? 0,
    location?.lng ?? 0,
    { enabled: !!location && status === "ready" }
  );
  const stops: StopWithDistance[] = (nearbyStopsData?.stops ?? [])
    .map((s) => ({
      ...s,
      distance_m: Math.round(haversineMeters(location?.lat ?? 0, location?.lng ?? 0, s.lat, s.lng)),
    }))
    .sort((a, b) => a.distance_m - b.distance_m);

  // TanStack Query: departures for selected stop
  const { data: departuresData, isLoading: departuresLoading } = useDepartures(
    selectedStop?.stop_id ?? "",
    { enabled: !!selectedStop }
  );
  const departures = departuresData?.departures ?? [];

  // Place search state
  const [mapSearch, setMapSearch] = useState("");
  const [suggestions, setSuggestions] = useState<AutocompleteResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<{ lat: number; lng: number; name: string; building_id?: string } | null>(null);
  const [placeRoutes, setPlaceRoutes] = useState<RecommendationOption[]>([]);
  const [placeRoutesLoading, setPlaceRoutesLoading] = useState(false);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  type LatLng = { latitude: number; longitude: number };
  const [walkPolylines, setWalkPolylines] = useState<LatLng[][]>([]);
  const [busPolylines, setBusPolylines] = useState<LatLng[][]>([]);

  const [vehicleCrowding, setVehicleCrowding] = useState<Record<string, CrowdingInfo>>({});
  const [crowdingSheet, setCrowdingSheet] = useState<{ vehicleId: string; routeId: string } | null>(null);

  const [showEmptyState, setShowEmptyState] = useState(true);
  const emptyStateOpacity = useRef(new Animated.Value(1)).current;

  const fadeOutEmptyState = useCallback(() => {
    setShowEmptyState(false);
    Animated.timing(emptyStateOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
  }, [emptyStateOpacity]);

  const fadeInEmptyState = useCallback(() => {
    setShowEmptyState(true);
    Animated.timing(emptyStateOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [emptyStateOpacity]);

  const mapRef = useRef<MapView | null>(null);
  const currentRegionRef = useRef({
    latitude: UIUC_FALLBACK.lat,
    longitude: UIUC_FALLBACK.lng,
    latitudeDelta: INITIAL_DELTA,
    longitudeDelta: INITIAL_DELTA,
  });

  const zoomIn = useCallback(() => {
    const r = currentRegionRef.current;
    const next = { ...r, latitudeDelta: r.latitudeDelta / 2, longitudeDelta: r.longitudeDelta / 2 };
    currentRegionRef.current = next;
    mapRef.current?.animateToRegion(next, 200);
  }, []);

  const zoomOut = useCallback(() => {
    const r = currentRegionRef.current;
    const next = {
      ...r,
      latitudeDelta: Math.min(r.latitudeDelta * 2, 80),
      longitudeDelta: Math.min(r.longitudeDelta * 2, 80),
    };
    currentRegionRef.current = next;
    mapRef.current?.animateToRegion(next, 200);
  }, []);

  const centerOnMe = useCallback(() => {
    const loc = location ?? UIUC_FALLBACK;
    if (!mapRef.current) return;
    mapRef.current.animateToRegion({
      latitude: loc.lat,
      longitude: loc.lng,
      latitudeDelta: INITIAL_DELTA,
      longitudeDelta: INITIAL_DELTA,
    }, 500);
  }, [location]);

  const loadStops = useCallback(async () => {
    setStatus("loading");
    let latitude: number;
    let longitude: number;

    if (useUiucArea) {
      latitude = UIUC_FALLBACK.lat;
      longitude = UIUC_FALLBACK.lng;
      setLocation(UIUC_FALLBACK);
    } else {
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== "granted") {
          setStatus("denied");
          setLocation(null);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
        const distToUiuc = haversineMeters(latitude, longitude, UIUC_FALLBACK.lat, UIUC_FALLBACK.lng);
        if (distToUiuc > 100_000) {
          latitude = UIUC_FALLBACK.lat;
          longitude = UIUC_FALLBACK.lng;
        }
        setLocation({ lat: latitude, lng: longitude });
      } catch {
        // GPS unavailable (e.g. simulator) — show the error UI; the
        // "Use UIUC area instead" button remains the explicit fallback.
        setStatus("error");
        return;
      }
    }

    setStatus("ready");
  }, [useUiucArea]);

  useEffect(() => {
    loadStops();
  }, [loadStops]);

  // Debounced autocomplete for place search
  useEffect(() => {
    const q = mapSearch.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetchAutocomplete(apiBaseUrl, q, { apiKey: apiKey ?? undefined });
        setSuggestions(res.results ?? []);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [mapSearch, apiBaseUrl, apiKey]);

  // Fetch routes when a place is selected
  useEffect(() => {
    if (!selectedPlace || !location) return;
    setPlaceRoutesLoading(true);
    setPlaceRoutes([]);
    const arriveBy = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    (async () => {
      try {
        const rec = await fetchRecommendation(apiBaseUrl, {
          lat: location.lat,
          lng: location.lng,
          ...(selectedPlace.building_id
            ? { destination_building_id: selectedPlace.building_id }
            : { destination_lat: selectedPlace.lat, destination_lng: selectedPlace.lng, destination_name: selectedPlace.name }),
          arrive_by_iso: arriveBy,
          max_options: 3,
          walking_speed_mps: walkingSpeedMps,
          buffer_minutes: bufferMinutes,
        }, { apiKey: apiKey ?? undefined });
        setPlaceRoutes(rec.options ?? []);
      } catch {
        setPlaceRoutes([]);
      } finally {
        setPlaceRoutesLoading(false);
      }
    })();
  }, [selectedPlace, location, apiBaseUrl, apiKey, walkingSpeedMps, bufferMinutes]);

  // Reset route index when fresh routes arrive
  useEffect(() => {
    setSelectedRouteIdx(0);
  }, [placeRoutes]);

  // Fetch walk + bus polylines for the selected route option
  useEffect(() => {
    if (!placeRoutes.length || !location || !selectedPlace) {
      setWalkPolylines([]);
      setBusPolylines([]);
      return;
    }
    const opt = placeRoutes[selectedRouteIdx];
    if (!opt) return;
    let cancelled = false;

    (async () => {
      const newWalk: { latitude: number; longitude: number }[][] = [];
      const newBus: { latitude: number; longitude: number }[][] = [];
      let prevLat = location.lat;
      let prevLng = location.lng;

      for (const step of opt.steps) {
        if (step.type === "WALK_TO_STOP" && step.stop_lat != null && step.stop_lng != null) {
          const [dLat, dLng] = [step.stop_lat, step.stop_lng];
          try {
            const res = await fetchWalkingRoute(apiBaseUrl, prevLat, prevLng, dLat, dLng, { apiKey: apiKey ?? undefined });
            newWalk.push(
              res.coords.length >= 2
                ? res.coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
                : [{ latitude: prevLat, longitude: prevLng }, { latitude: dLat, longitude: dLng }]
            );
          } catch {
            newWalk.push([{ latitude: prevLat, longitude: prevLng }, { latitude: dLat, longitude: dLng }]);
          }
          prevLat = dLat;
          prevLng = dLng;
        } else if (step.type === "RIDE" && step.route && step.stop_id) {
          // Alighting coords — if missing and WALK_TO_DEST follows, skip bus line (walk handles last mile)
          const hasWalkToDest = opt.steps.some(s => s.type === "WALK_TO_DEST");
          const aLatRaw = step.alighting_stop_lat ?? (hasWalkToDest ? null : selectedPlace.lat);
          const aLngRaw = step.alighting_stop_lng ?? (hasWalkToDest ? null : selectedPlace.lng);

          if (aLatRaw != null && aLngRaw != null) {
            const aLat = aLatRaw;
            const aLng = aLngRaw;

            const roadFallback = async () => {
              try {
                const w = await fetchWalkingRoute(apiBaseUrl, prevLat, prevLng, aLat, aLng, { apiKey: apiKey ?? undefined });
                return w.coords.length >= 2
                  ? w.coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
                  : [{ latitude: prevLat, longitude: prevLng }, { latitude: aLat, longitude: aLng }];
              } catch {
                return [{ latitude: prevLat, longitude: prevLng }, { latitude: aLat, longitude: aLng }];
              }
            };

            if (step.alighting_stop_id) {
              const afterTime = new Date().toTimeString().slice(0, 5);
              try {
                const res = await fetchBusRouteStops(apiBaseUrl, step.route, step.stop_id, step.alighting_stop_id, afterTime, { apiKey: apiKey ?? undefined });
                newBus.push(
                  res.shape_points.length >= 2
                    ? res.shape_points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
                    : await roadFallback()
                );
              } catch {
                newBus.push(await roadFallback());
              }
            } else {
              newBus.push(await roadFallback());
            }
            prevLat = aLat;
            prevLng = aLng;
          }
          // else: no alighting coords + WALK_TO_DEST follows → skip bus line, prevLat/Lng unchanged
        } else if (step.type === "WALK_TO_DEST") {
          const dLat = selectedPlace.lat;
          const dLng = selectedPlace.lng;
          try {
            const res = await fetchWalkingRoute(apiBaseUrl, prevLat, prevLng, dLat, dLng, { apiKey: apiKey ?? undefined });
            newWalk.push(
              res.coords.length >= 2
                ? res.coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
                : [{ latitude: prevLat, longitude: prevLng }, { latitude: dLat, longitude: dLng }]
            );
          } catch {
            newWalk.push([{ latitude: prevLat, longitude: prevLng }, { latitude: dLat, longitude: dLng }]);
          }
        }
      }

      // WALK-only with no step breakdown
      if (opt.type === "WALK" && newWalk.length === 0) {
        try {
          const res = await fetchWalkingRoute(apiBaseUrl, location.lat, location.lng, selectedPlace.lat, selectedPlace.lng, { apiKey: apiKey ?? undefined });
          newWalk.push(
            res.coords.length >= 2
              ? res.coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
              : [{ latitude: location.lat, longitude: location.lng }, { latitude: selectedPlace.lat, longitude: selectedPlace.lng }]
          );
        } catch {
          newWalk.push([{ latitude: location.lat, longitude: location.lng }, { latitude: selectedPlace.lat, longitude: selectedPlace.lng }]);
        }
      }

      if (cancelled) return;
      setWalkPolylines(newWalk);
      setBusPolylines(newBus);

      // Fit map to show the full route
      const all = [...newWalk.flat(), ...newBus.flat()];
      if (all.length >= 2 && mapRef.current) {
        mapRef.current.fitToCoordinates(all, {
          edgePadding: { top: 100, right: 40, bottom: 320, left: 40 },
          animated: true,
        });
      }
    })();

    return () => { cancelled = true; };
  }, [placeRoutes, selectedRouteIdx, location, selectedPlace, apiBaseUrl, apiKey]);

  useEffect(() => {
    if (!vehicles.length || !apiBaseUrl) return;
    let cancelled = false;
    async function pollCrowding() {
      const updates: Record<string, CrowdingInfo> = {};
      await Promise.all(
        vehicles.map(async (v) => {
          const info = await fetchCrowding(apiBaseUrl, v.vehicle_id, v.route_id, { apiKey: apiKey ?? undefined });
          if (info) updates[v.vehicle_id] = info;
        })
      );
      if (!cancelled) setVehicleCrowding((prev) => ({ ...prev, ...updates }));
    }
    pollCrowding();
    const id = setInterval(pollCrowding, 30_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles.map(v => v.vehicle_id).join(","), apiBaseUrl, apiKey]);

  const onSelectSuggestion = useCallback(async (result: AutocompleteResult) => {
    Keyboard.dismiss();
    setMapSearch(result.name);
    setSuggestions([]);
    setSelectedStop(null);
    fadeOutEmptyState();

    let lat = result.lat;
    let lng = result.lng;
    let name = result.display_name ?? result.name;

    if (lat !== 0 && lng !== 0) {
      // Coords already embedded — use directly
    } else if (result.type === "google_place" && result.place_id) {
      // Fallback: resolve via /places/details when backend didn't embed coords
      try {
        const details = await fetchPlaceDetails(apiBaseUrl, result.place_id, { apiKey: apiKey ?? undefined });
        lat = details.lat;
        lng = details.lng;
        if (details.display_name) name = details.display_name;
      } catch {
        // Leave lat/lng as 0 — setSelectedPlace will still be set but map won't animate meaningfully
      }
    }

    setSelectedPlace({ lat, lng, name, building_id: result.building_id });
    mapRef.current?.animateToRegion({
      latitude: lat,
      longitude: lng,
      latitudeDelta: INITIAL_DELTA,
      longitudeDelta: INITIAL_DELTA,
    }, 500);
  }, [apiBaseUrl, apiKey, fadeOutEmptyState]);

  const clearSearch = useCallback(() => {
    setMapSearch("");
    setSuggestions([]);
    setSelectedPlace(null);
    setPlaceRoutes([]);
    setWalkPolylines([]);
    setBusPolylines([]);
    setSelectedRouteIdx(0);
    fadeInEmptyState();
  }, [fadeInEmptyState]);

  const onStartNavigation = useCallback((opt: RecommendationOption) => {
    if (!selectedPlace) return;
    if (opt.type === "WALK") {
      router.push({
        pathname: "/walk-nav",
        params: {
          dest_lat: String(selectedPlace.lat),
          dest_lng: String(selectedPlace.lng),
          dest_name: selectedPlace.name,
          walking_mode_id: walkingModeId,
        },
      });
    } else {
      const walkStep = opt.steps.find((s) => s.type === "WALK_TO_STOP");
      const rideStep = opt.steps.find((s) => s.type === "RIDE");
      router.push({
        pathname: "/walk-nav",
        params: {
          dest_lat: String(walkStep?.stop_lat ?? selectedPlace.lat),
          dest_lng: String(walkStep?.stop_lng ?? selectedPlace.lng),
          dest_name: walkStep?.stop_name ?? selectedPlace.name,
          walking_mode_id: walkingModeId,
          route_id: rideStep?.route ?? "",
          stop_id: walkStep?.stop_id ?? "",
          alighting_stop_id: rideStep?.alighting_stop_id ?? "",
          alighting_lat: String(rideStep?.alighting_stop_lat ?? ""),
          alighting_lng: String(rideStep?.alighting_stop_lng ?? ""),
          final_lat: String(selectedPlace.lat),
          final_lng: String(selectedPlace.lng),
          final_name: selectedPlace.name,
        },
      });
    }
  }, [selectedPlace, walkingModeId, router]);

  const onMarkerPress = useCallback(
    (stop: StopWithDistance) => {
      setSelectedStop(stop);
      setSelectedPlace(null);
      setPlaceRoutes([]);
      setMapSearch("");
      setSuggestions([]);
    },
    []
  );

  const onOpenTrip = useCallback(
    (stop: StopWithDistance) => {
      router.push({
        pathname: "/trip",
        params: { stop_id: stop.stop_id, stop_name: stop.stop_name },
      });
    },
    [router]
  );

  if (Platform.OS === "web") {
    return (
      <View style={styles.centered}>
        <Text style={styles.fallbackTitle}>Map</Text>
        <Text style={styles.fallbackText}>
          The map is not available on web. Use the iOS or Android app.
        </Text>
        <Text style={styles.fallbackHint}>See docs for adding Google Maps API keys on native.</Text>
      </View>
    );
  }

  if (status === "denied") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Location permission denied</Text>
        <Text style={styles.hint}>Enable location in Settings, or use the UIUC area to see the map.</Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => Linking.openSettings()}
          accessibilityLabel="Open location settings"
          accessibilityRole="button"
        >
          <Text style={styles.retryBtnText}>Open Location Settings</Text>
        </Pressable>
        {/* Only flip the flag: the loadStops useCallback closes over the old
            useUiucArea, so calling it here would retry GPS and its late
            setStatus could clobber the effect-driven reload that the flag
            change triggers via useEffect([loadStops]). */}
        <Pressable
          style={[styles.retryBtn, styles.retryBtnSecondary]}
          onPress={() => setUseUiucArea(true)}
          accessibilityRole="button"
          accessibilityLabel="Use UIUC area, Champaign-Urbana"
        >
          <Text style={styles.retryBtnSecondaryText}>Use UIUC area (Champaign-Urbana)</Text>
        </Pressable>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Could not load stops</Text>
        <Text style={styles.hint}>Check API URL in Settings and try again.</Text>
        <Pressable style={styles.retryBtn} onPress={loadStops} accessibilityRole="button" accessibilityLabel="Retry loading stops">
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
        {/* Only flip the flag (see comment on the denied screen): the stale
            loadStops closure would retry GPS, fail, and set "error" after the
            effect-driven reload already set "ready". */}
        <Pressable
          style={[styles.retryBtn, styles.retryBtnSecondary]}
          onPress={() => setUseUiucArea(true)}
          accessibilityRole="button"
          accessibilityLabel="Use UIUC area instead"
        >
          <Text style={styles.retryBtnSecondaryText}>Use UIUC area instead</Text>
        </Pressable>
      </View>
    );
  }

  const mapCenter = location ?? UIUC_FALLBACK;
  const initialRegion = {
    latitude: mapCenter.lat,
    longitude: mapCenter.lng,
    latitudeDelta: INITIAL_DELTA,
    longitudeDelta: INITIAL_DELTA,
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        onPress={() => { Keyboard.dismiss(); setSuggestions([]); }}
        onRegionChangeComplete={(r) => { currentRegionRef.current = r; }}
      >
        {stops.map((stop) => {
          const isSelected = selectedStop?.stop_id === stop.stop_id;
          return (
            <Marker
              // Selection is baked into the rasterized dot, so key on it: the
              // marker remounts (redrawing once) when selection flips instead of
              // re-rasterizing continuously (tracksViewChanges stays false).
              key={`stop-${stop.stop_id}-${isSelected ? "selected" : "idle"}`}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}
              coordinate={{ latitude: stop.lat, longitude: stop.lng }}
              title={stop.stop_name}
              description={`${formatDistance(stop.distance_m)} away`}
              onPress={() => onMarkerPress(stop)}
              accessibilityLabel={`Bus stop ${stop.stop_name}, ${formatDistance(stop.distance_m)} away${isSelected ? ", selected" : ""}`}
            >
              <StopDot selected={isSelected} />
            </Marker>
          );
        })}
        {selectedPlace && (
          <Marker
            coordinate={{ latitude: selectedPlace.lat, longitude: selectedPlace.lng }}
            title={selectedPlace.name}
            anchor={{ x: 0.5, y: 1.0 }}
            key="dest"
            tracksViewChanges={false}
          >
            <View style={{ alignItems: 'center' }}>
              <View style={{
                width: 22, height: 22, borderRadius: 11,
                backgroundColor: theme.colors.navy,
                borderWidth: 2.5, borderColor: theme.colors.surface,
                shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3, shadowRadius: 3, elevation: 4,
                justifyContent: 'center', alignItems: 'center',
              }}>
                <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.colors.surface }} />
              </View>
              <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7,
                borderLeftColor: 'transparent', borderRightColor: 'transparent',
                borderTopColor: theme.colors.navy, marginTop: -1 }} />
            </View>
          </Marker>
        )}
        {vehicles.map((v) => {
          const crowding = vehicleCrowding[v.vehicle_id];
          const ringColor = crowdThemeColor(crowding);
          const glyph = crowding ? CROWDING_ICONS[crowding.level] ?? null : null;
          // Quantize heading to 30° buckets so the rasterized marker only
          // redraws when the bus meaningfully turns (tracksViewChanges stays false).
          const headingDeg = Number.isFinite(v.heading)
            ? (Math.round((((v.heading % 360) + 360) % 360) / 30) * 30) % 360
            : null;
          return (
            <Marker
              // ringColor (plus the crowding glyph and heading bucket) is baked
              // into the bitmap, so key on it: the marker remounts (redrawing
              // once) when crowding or heading changes, instead of
              // re-rasterizing on every frame to catch values that rarely move.
              key={`vehicle-${v.vehicle_id}-${ringColor}-${crowding?.level ?? "none"}-${headingDeg ?? "x"}`}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}
              coordinate={{ latitude: v.lat, longitude: v.lng }}
              title={`Bus ${v.route_id}`}
              description={v.headsign || undefined}
              onPress={() => setCrowdingSheet({ vehicleId: v.vehicle_id, routeId: v.route_id })}
              accessibilityLabel={`Bus ${v.route_id}${v.headsign ? ` to ${v.headsign}` : ""}, crowding ${crowdingLabel(crowding)}`}
            >
              <VehicleDot ringColor={ringColor} headingDeg={headingDeg} glyph={glyph} />
            </Marker>
          );
        })}
        {walkPolylines.map((coords, i) => (
          <React.Fragment key={`walk-frag-${selectedRouteIdx}-${i}`}>
            <Polyline
              key={`walk-outline-${selectedRouteIdx}-${i}`}
              coordinates={coords}
              strokeColor="rgba(255,255,255,0.85)"
              strokeWidth={6}
              lineDashPattern={[8, 6]}
              zIndex={8}
              lineCap={"round" as any}
            />
            <Polyline
              key={`walk-main-${selectedRouteIdx}-${i}`}
              coordinates={coords}
              strokeColor={theme.colors.navy}
              strokeWidth={3}
              lineDashPattern={[8, 6]}
              zIndex={9}
              lineCap={"round" as any}
            />
          </React.Fragment>
        ))}
        {busPolylines.map((coords, i) => (
          <React.Fragment key={`bus-frag-${selectedRouteIdx}-${i}`}>
            <Polyline
              key={`bus-shadow-${selectedRouteIdx}-${i}`}
              coordinates={coords}
              strokeColor="rgba(19,41,75,0.25)"
              strokeWidth={9}
              zIndex={10}
              lineCap={"round" as any}
              lineJoin={"round" as any}
            />
            <Polyline
              key={`bus-main-${selectedRouteIdx}-${i}`}
              coordinates={coords}
              strokeColor={theme.colors.orange}
              strokeWidth={5}
              zIndex={11}
              lineCap={"round" as any}
              lineJoin={"round" as any}
            />
          </React.Fragment>
        ))}
      </MapView>

      {crowdingSheet && (
        <CrowdingSheet
          visible={!!crowdingSheet}
          vehicleId={crowdingSheet.vehicleId}
          routeId={crowdingSheet.routeId}
          onClose={() => setCrowdingSheet(null)}
        />
      )}

      {/* Search bar */}
      {status === "loading" && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color={theme.colors.navy} />
        </View>
      )}
      <View style={styles.searchContainer}>
        <View style={styles.searchRow}>
          <Search size={16} color={theme.colors.textMuted} style={{ marginLeft: 12, marginRight: 4 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search restaurants, buildings, places..."
            placeholderTextColor={theme.colors.textMuted}
            value={mapSearch}
            onChangeText={(text) => { setMapSearch(text); if (text.length > 0) fadeOutEmptyState(); else fadeInEmptyState(); }}
            returnKeyType="search"
            autoCorrect={false}
          />
          {mapSearch.length > 0 && (
            <Pressable
              style={styles.clearBtn}
              onPress={clearSearch}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <X size={14} color={theme.colors.textMuted} />
            </Pressable>
          )}
        </View>
        {suggestions.length > 0 && (
          <ScrollView style={styles.suggestionList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {suggestions.map((r, i) => (
              <Pressable
                key={i}
                style={styles.suggestionRow}
                onPress={() => onSelectSuggestion(r)}
                accessibilityRole="button"
                accessibilityLabel={r.display_name && r.display_name !== r.name ? `${r.name}, ${r.display_name}` : r.name}
              >
                <Text style={styles.suggestionName}>{r.name}</Text>
                {r.display_name && r.display_name !== r.name && (
                  <Text style={styles.suggestionSub} numberOfLines={1}>{r.display_name}</Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {useUiucArea && (
        <View style={styles.uiucBanner}>
          <Text style={styles.uiucBannerText}>Showing UIUC area</Text>
          <Pressable
            onPress={() => { setUseUiucArea(false); loadStops(); }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Use my location"
          >
            <Text style={styles.uiucBannerLink}>Use my location</Text>
          </Pressable>
        </View>
      )}
      {vehicles.length > 0 && (
        <View style={styles.vehicleLegend}>
          <MapLiveBadge count={vehicles.length} />
        </View>
      )}
      <PressableScale
        style={styles.centerBtn}
        onPress={centerOnMe}
        accessibilityRole="button"
        accessibilityLabel="Center map on my location"
        scaleTo={0.88}
      >
        <MapPin size={20} color={theme.colors.textOnNavy} />
      </PressableScale>

      {/* Zoom controls */}
      <View style={styles.zoomControls}>
        <PressableScale style={styles.zoomBtn} onPress={zoomIn} accessibilityRole="button" accessibilityLabel="Zoom in" scaleTo={0.85}>
          <Text style={styles.zoomBtnText}>+</Text>
        </PressableScale>
        <View style={styles.zoomDivider} />
        <PressableScale style={styles.zoomBtn} onPress={zoomOut} accessibilityRole="button" accessibilityLabel="Zoom out" scaleTo={0.85}>
          <Text style={styles.zoomBtnText}>−</Text>
        </PressableScale>
      </View>

      {/* Place route panel */}
      {selectedPlace && (
        <FadeInView dy={28} duration={theme.motion.base} style={styles.detailCard}>
          <View style={styles.grabber} />
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle} numberOfLines={1}>{selectedPlace.name}</Text>
            {location && (
              <Text style={styles.detailDistance}>
                {formatDistance(haversineMeters(location.lat, location.lng, selectedPlace.lat, selectedPlace.lng))} away
              </Text>
            )}
          </View>
          {placeRoutesLoading ? (
            <View style={styles.panelSkeletons}>
              <Skeleton height={64} radius={theme.radius.lg} />
              <Skeleton height={64} radius={theme.radius.lg} />
            </View>
          ) : placeRoutes.length > 0 ? (
            <ScrollView style={styles.routeList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {placeRoutes.map((opt, i) => {
                const optionLabel = opt.type === "WALK" ? "Walk" : i === 0 ? "Best option" : "Alternative";
                const optionMeta =
                  opt.type === "WALK"
                    ? `${opt.eta_minutes} min walk`
                    : opt.depart_in_minutes <= 1
                    ? `Leave now · ${opt.eta_minutes} min total`
                    : `Leave in ${opt.depart_in_minutes} min · ${opt.eta_minutes} min total`;
                return (
                  <FadeInView key={i} delay={i * 60} dy={10}>
                    <Pressable
                      style={[styles.routeRow, selectedRouteIdx === i && styles.routeRowSelected]}
                      onPress={() => setSelectedRouteIdx(i)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedRouteIdx === i }}
                      accessibilityLabel={`${optionLabel}, ${optionMeta}`}
                    >
                      <View style={styles.routeInfo}>
                        <Text style={styles.routeLabel}>{optionLabel}</Text>
                        <Text style={styles.routeMeta}>{optionMeta}</Text>
                        <View style={styles.stepChips}>
                          {opt.steps
                            .filter(s => s.type === 'WALK_TO_STOP' || s.type === 'RIDE' || s.type === 'WALK_TO_DEST')
                            .map((step, si) => (
                              <View key={si} style={[styles.stepChip, step.type === 'RIDE' ? styles.stepChipRide : styles.stepChipWalk]}>
                                {step.type === 'RIDE'
                                  ? <Bus size={10} color={theme.colors.brandInk} />
                                  : <Footprints size={10} color={theme.colors.navy} />}
                                <Text style={[styles.stepChipText, { color: step.type === 'RIDE' ? theme.colors.brandInk : theme.colors.navy }]}>
                                  {step.type === 'RIDE'
                                    ? (step.route_short_name || step.route || 'Bus')
                                    : `${Math.round((step.walk_distance_m || 0) / 80)}m`}
                                </Text>
                              </View>
                            ))}
                        </View>
                      </View>
                      <PressableScale
                        style={styles.startBtn}
                        onPress={() => onStartNavigation(opt)}
                        scaleTo={0.92}
                        accessibilityRole="button"
                        accessibilityLabel={`Start ${opt.type === "WALK" ? "walking" : "bus"} navigation`}
                      >
                        <LinearGradient
                          colors={[theme.gradients.sunset[0], theme.gradients.sunset[1]]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.startBtnFill}
                        >
                          <Text style={styles.startBtnText}>Go</Text>
                        </LinearGradient>
                      </PressableScale>
                    </Pressable>
                  </FadeInView>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={styles.depEmpty}>No routes available right now.</Text>
          )}
        </FadeInView>
      )}

      {/* Bus stop detail card */}
      {selectedStop && !selectedPlace && (
        <FadeInView dy={28} duration={theme.motion.base} style={styles.detailCard}>
          <View style={styles.grabber} />
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>{selectedStop.stop_name}</Text>
            <Text style={styles.detailDistance}>{formatDistance(selectedStop.distance_m)} away</Text>
          </View>
          <View style={styles.tripBtnWrap}>
            <Button label="View departures" onPress={() => onOpenTrip(selectedStop)} variant="primary" />
          </View>
          {departuresLoading ? (
            <View style={styles.panelSkeletons}>
              <Skeleton height={44} radius={theme.radius.md} />
              <Skeleton height={44} radius={theme.radius.md} />
            </View>
          ) : departures.length > 0 ? (
            <ScrollView style={styles.depList} nestedScrollEnabled>
              {departures.slice(0, 8).map((d, i) => (
                <FadeInView key={i} delay={i * 45} dy={8}>
                  <DepartureRow
                    route={d.route}
                    headsign={d.headsign || "—"}
                    expectedMins={d.expected_mins}
                    isRealtime={d.is_realtime}
                    expectedTimeIso={d.expected_time_iso}
                    delayStatus={d.delay_status}
                    delayMins={d.delay_mins}
                  />
                </FadeInView>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.depEmpty}>No departures in the next 60 min.</Text>
          )}
        </FadeInView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1, width: "100%", height: "100%" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: theme.spacing.lg + 4, backgroundColor: theme.colors.surfaceAlt },
  errorText: { ...theme.text.heading, fontSize: 18, color: theme.colors.errorDeep },
  hint: { ...theme.text.caption, fontSize: 14, color: theme.colors.textSecondary, marginTop: theme.spacing.sm + 2, textAlign: "center" },
  retryBtn: {
    marginTop: theme.spacing.lg - 4,
    minHeight: theme.layout.tapMin,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg + 4,
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.lg,
    ...theme.shadows.glowNavy,
  },
  retryBtnSecondary: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: theme.colors.navy, marginTop: theme.spacing.sm + 2, ...theme.elevation[0] },
  retryBtnText: { ...theme.text.subhead, fontSize: 16, color: theme.colors.textOnNavy },
  retryBtnSecondaryText: { ...theme.text.subhead, color: theme.colors.navy },
  loadingOverlay: {
    position: "absolute",
    top: 70,
    alignSelf: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    padding: theme.spacing.sm + 2,
    zIndex: 10,
    ...theme.elevation[2],
  },
  searchContainer: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 80,
    zIndex: 10,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    paddingLeft: 6,
    ...theme.shadows.lg,
  },
  searchInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 8,
    fontSize: 15,
    fontFamily: "DMSans_400Regular",
    color: theme.colors.text,
  },
  clearBtn: {
    minWidth: theme.layout.tapMin,
    minHeight: theme.layout.tapMin,
    justifyContent: "center",
    alignItems: "center",
  },
  suggestionList: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    marginTop: 6,
    maxHeight: 220,
    overflow: "hidden",
    ...theme.shadows.lg,
  },
  suggestionRow: {
    minHeight: theme.layout.tapMin,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.borderSoft,
  },
  suggestionName: { ...theme.text.subhead, color: theme.colors.text },
  suggestionSub: { ...theme.text.caption, fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  uiucBanner: {
    position: "absolute",
    top: 72,
    left: theme.layout.gutter,
    right: 80,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.sm + 2,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 20,
    ...theme.elevation[2],
  },
  uiucBannerText: { ...theme.text.caption, color: theme.colors.textSecondary },
  uiucBannerLink: { ...theme.text.subhead, fontSize: 13, color: theme.colors.brandInk },
  vehicleLegend: {
    position: "absolute",
    top: 116,
    left: theme.layout.gutter,
    zIndex: 19,
  },
  fallbackTitle: { fontSize: 20, fontFamily: "DMSans_700Bold", color: theme.colors.navy, marginBottom: 8 },
  fallbackText: { fontSize: 16, fontFamily: "DMSans_400Regular", color: theme.colors.text, textAlign: "center" },
  fallbackHint: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginTop: 12, textAlign: "center" },
  centerBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: theme.colors.navy,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadows.glowNavy,
  },
  zoomControls: {
    position: "absolute",
    top: 76,
    right: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    ...theme.shadows.lg,
  },
  zoomBtn: {
    width: 48,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomBtnText: {
    fontSize: 22,
    fontFamily: "DMSans_400Regular",
    color: theme.colors.navy,
    lineHeight: 26,
  },
  zoomDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginHorizontal: 8,
  },
  detailCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xxl,
    borderTopRightRadius: theme.radius.xxl,
    padding: 16,
    paddingTop: 18,
    maxHeight: 300,
    shadowColor: "#0B1B36",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 10,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
    marginTop: -6,
    marginBottom: 10,
  },
  detailHeader: { marginBottom: 10 },
  detailTitle: { ...theme.text.title2, fontSize: 20, lineHeight: 26, color: theme.colors.navy },
  detailDistance: { ...theme.text.caption, fontSize: 13, color: theme.colors.textMuted, marginTop: 4, fontVariant: ["tabular-nums"] },
  routeList: { maxHeight: 220 },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: theme.layout.tapMin,
    paddingVertical: theme.spacing.md - 2,
    paddingHorizontal: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.borderSoft,
    borderRadius: theme.radius.md,
  },
  routeRowSelected: {
    backgroundColor: theme.colors.orangeSoft,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.orange,
  },
  routeInfo: { flex: 1, marginRight: theme.spacing.md },
  routeLabel: { ...theme.text.subhead, color: theme.colors.navy },
  routeMeta: { ...theme.text.caption, color: theme.colors.textSecondary, marginTop: 2, fontVariant: ["tabular-nums"] },
  stepChips: { flexDirection: "row", gap: 4, marginTop: 5, flexWrap: "wrap" },
  stepChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
  },
  stepChipRide: { backgroundColor: theme.colors.orangeSoft },
  stepChipWalk: { backgroundColor: theme.colors.borderSoft },
  stepChipText: { ...theme.text.badge, fontSize: 11, fontVariant: ["tabular-nums"] },
  startBtn: {
    minWidth: theme.layout.tapMin,
    minHeight: theme.layout.tapMin,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    ...theme.shadows.glowOrange,
  },
  startBtnFill: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing.sm + 3,
    paddingHorizontal: theme.spacing.lg - 2,
  },
  startBtnText: { ...theme.text.subhead, color: theme.colors.surface },
  tripBtnWrap: { marginBottom: theme.layout.cardGap },
  panelSkeletons: { gap: theme.spacing.sm + 2, marginVertical: theme.spacing.sm + 2 },
  depList: { maxHeight: 150 },
  depEmpty: { ...theme.text.caption, fontSize: 14, color: theme.colors.textMuted, fontStyle: "italic", marginTop: theme.spacing.sm + 2 },
});

const markerStyles = StyleSheet.create({
  vehicleWrap: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headingLayer: { position: "absolute", width: 44, height: 44, alignItems: "center" },
  headingWedge: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: theme.colors.navy,
  },
  vehicleDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 3,
    backgroundColor: theme.colors.orange,
    alignItems: "center",
    justifyContent: "center",
    ...theme.elevation[1],
  },
  vehicleCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.surface },
  crowdBubble: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  crowdGlyph: { fontSize: 8, lineHeight: 10 },
  stopIdle: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.navy,
    borderWidth: 2,
    borderColor: theme.colors.surface,
  },
  stopSelectedOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.navy,
    borderWidth: 3,
    borderColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...theme.elevation[2],
  },
  stopSelectedInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.orange },
});
