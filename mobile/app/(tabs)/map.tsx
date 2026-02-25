import { fetchAutocomplete, fetchDepartures, fetchNearbyStops, fetchRecommendation, fetchVehicles } from "@/src/api/client";
import type { AutocompleteResult } from "@/src/api/client";
import type { DepartureItem, RecommendationOption, StopInfo, VehicleInfo } from "@/src/api/types";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useRecommendationSettings } from "@/src/hooks/useRecommendationSettings";
import { formatDistance, haversineMeters } from "@/src/utils/distance";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { theme } from "@/src/constants/theme";

const MAP_RADIUS_M = 1200;
const INITIAL_DELTA = 0.008;
const UIUC_FALLBACK = { lat: 40.1020, lng: -88.2272 };
const VEHICLE_POLL_MS = 15_000;

type StopWithDistance = StopInfo & { distance_m: number };

export default function MapScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { walkingModeId, walkingSpeedMps, bufferMinutes } = useRecommendationSettings();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "denied" | "error" | "ready">("loading");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(UIUC_FALLBACK);
  const [stops, setStops] = useState<StopWithDistance[]>([]);
  const [selectedStop, setSelectedStop] = useState<StopWithDistance | null>(null);
  const [departures, setDepartures] = useState<DepartureItem[]>([]);
  const [departuresLoading, setDeparturesLoading] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleInfo[]>([]);
  const [useUiucArea, setUseUiucArea] = useState(false);

  // Place search state
  const [mapSearch, setMapSearch] = useState("");
  const [suggestions, setSuggestions] = useState<AutocompleteResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<{ lat: number; lng: number; name: string; building_id?: string } | null>(null);
  const [placeRoutes, setPlaceRoutes] = useState<RecommendationOption[]>([]);
  const [placeRoutesLoading, setPlaceRoutesLoading] = useState(false);

  const mapRef = useRef<MapView | null>(null);
  const vehiclePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const pollVehicles = useCallback(async () => {
    try {
      const res = await fetchVehicles(apiBaseUrl, undefined, { apiKey: apiKey ?? undefined });
      setVehicles(res.vehicles ?? []);
    } catch {
      // Silently fail — vehicles are optional
    }
  }, [apiBaseUrl, apiKey]);

  const loadStops = useCallback(async () => {
    setStatus("loading");
    try {
      let latitude: number;
      let longitude: number;
      if (useUiucArea) {
        latitude = UIUC_FALLBACK.lat;
        longitude = UIUC_FALLBACK.lng;
        setLocation(UIUC_FALLBACK);
      } else {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== "granted") {
          setStatus("denied");
          setLocation(null);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
        // Snap to UIUC if GPS is far away (e.g. simulator default = San Francisco)
        const distToUiuc = haversineMeters(latitude, longitude, UIUC_FALLBACK.lat, UIUC_FALLBACK.lng);
        if (distToUiuc > 100_000) {
          latitude = UIUC_FALLBACK.lat;
          longitude = UIUC_FALLBACK.lng;
        }
        setLocation({ lat: latitude, lng: longitude });
      }
      const data = await fetchNearbyStops(apiBaseUrl, latitude, longitude, MAP_RADIUS_M, { apiKey: apiKey ?? undefined });
      const withDist = data.stops
        .map((s) => ({
          ...s,
          distance_m: Math.round(haversineMeters(latitude, longitude, s.lat, s.lng)),
        }))
        .sort((a, b) => a.distance_m - b.distance_m);
      setStops(withDist);
      setStatus("ready");
    } catch {
      setStatus("error");
      setStops([]);
      setLocation(null);
    }
  }, [apiBaseUrl, apiKey, useUiucArea]);

  useEffect(() => {
    loadStops();
  }, [loadStops]);

  // Poll vehicles every 15s while map is visible
  useEffect(() => {
    if (status !== "ready") return;
    pollVehicles();
    vehiclePollRef.current = setInterval(pollVehicles, VEHICLE_POLL_MS);
    return () => {
      if (vehiclePollRef.current) {
        clearInterval(vehiclePollRef.current);
        vehiclePollRef.current = null;
      }
    };
  }, [status, pollVehicles]);

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

  const onSelectSuggestion = useCallback((result: AutocompleteResult) => {
    Keyboard.dismiss();
    setMapSearch(result.name);
    setSuggestions([]);
    setSelectedStop(null);
    setSelectedPlace({ lat: result.lat, lng: result.lng, name: result.display_name ?? result.name, building_id: result.building_id });
    mapRef.current?.animateToRegion({
      latitude: result.lat,
      longitude: result.lng,
      latitudeDelta: INITIAL_DELTA,
      longitudeDelta: INITIAL_DELTA,
    }, 500);
  }, []);

  const clearSearch = useCallback(() => {
    setMapSearch("");
    setSuggestions([]);
    setSelectedPlace(null);
    setPlaceRoutes([]);
  }, []);

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
        },
      });
    }
  }, [selectedPlace, walkingModeId, router]);

  const onMarkerPress = useCallback(
    async (stop: StopWithDistance) => {
      setSelectedStop(stop);
      setSelectedPlace(null);
      setPlaceRoutes([]);
      setMapSearch("");
      setSuggestions([]);
      setDepartures([]);
      setDeparturesLoading(true);
      try {
        const res = await fetchDepartures(apiBaseUrl, stop.stop_id, 60, { apiKey: apiKey ?? undefined });
        setDepartures(res.departures ?? []);
      } catch {
        setDepartures([]);
      } finally {
        setDeparturesLoading(false);
      }
    },
    [apiBaseUrl, apiKey]
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

  if (status === "loading") {
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
        <Text style={styles.hint}>Enable location in Settings, or use the UIUC area to see the map.</Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => Linking.openSettings()}
          accessibilityLabel="Open location settings"
          accessibilityRole="button"
        >
          <Text style={styles.retryBtnText}>Open Location Settings</Text>
        </Pressable>
        <Pressable style={[styles.retryBtn, styles.retryBtnSecondary]} onPress={() => { setUseUiucArea(true); loadStops(); }}>
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
        <Pressable style={styles.retryBtn} onPress={loadStops}>
          <Text style={styles.retryBtnText}>Retry</Text>
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
        key={`map-${mapCenter.lat}-${mapCenter.lng}`}
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        onPress={() => { Keyboard.dismiss(); setSuggestions([]); }}
      >
        {stops.map((stop) => (
          <Marker
            key={stop.stop_id}
            coordinate={{ latitude: stop.lat, longitude: stop.lng }}
            title={stop.stop_name}
            description={`${formatDistance(stop.distance_m)} away`}
            onPress={() => onMarkerPress(stop)}
            pinColor={selectedStop?.stop_id === stop.stop_id ? "#13294b" : "#c41e3a"}
          />
        ))}
        {selectedPlace && (
          <Marker
            coordinate={{ latitude: selectedPlace.lat, longitude: selectedPlace.lng }}
            title={selectedPlace.name}
            pinColor="#2e7d32"
          />
        )}
        {vehicles.map((v) => (
          <Marker
            key={`vehicle-${v.vehicle_id}`}
            coordinate={{ latitude: v.lat, longitude: v.lng }}
            title={`Bus ${v.route_id}`}
            description={v.headsign || undefined}
            pinColor="#e35205"
          />
        ))}
      </MapView>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search restaurants, buildings, places..."
            placeholderTextColor="#999"
            value={mapSearch}
            onChangeText={setMapSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
          {mapSearch.length > 0 && (
            <Pressable style={styles.clearBtn} onPress={clearSearch}>
              <Text style={styles.clearBtnText}>✕</Text>
            </Pressable>
          )}
        </View>
        {suggestions.length > 0 && (
          <ScrollView style={styles.suggestionList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {suggestions.map((r, i) => (
              <Pressable key={i} style={styles.suggestionRow} onPress={() => onSelectSuggestion(r)}>
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
          <Pressable onPress={() => { setUseUiucArea(false); loadStops(); }}>
            <Text style={styles.uiucBannerLink}>Use my location</Text>
          </Pressable>
        </View>
      )}
      {vehicles.length > 0 && (
        <View style={styles.vehicleLegend}>
          <View style={styles.vehicleDot} />
          <Text style={styles.vehicleLegendText}>Live buses ({vehicles.length})</Text>
        </View>
      )}
      <Pressable style={styles.centerBtn} onPress={centerOnMe}>
        <Text style={styles.centerBtnText}>📍 Center on me</Text>
      </Pressable>

      {/* Place route panel */}
      {selectedPlace && (
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle} numberOfLines={1}>{selectedPlace.name}</Text>
            {location && (
              <Text style={styles.detailDistance}>
                {formatDistance(haversineMeters(location.lat, location.lng, selectedPlace.lat, selectedPlace.lng))} away
              </Text>
            )}
          </View>
          {placeRoutesLoading ? (
            <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginVertical: 12 }} />
          ) : placeRoutes.length > 0 ? (
            <ScrollView style={styles.routeList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {placeRoutes.map((opt, i) => (
                <View key={i} style={styles.routeRow}>
                  <View style={styles.routeInfo}>
                    <Text style={styles.routeLabel}>
                      {opt.type === "WALK" ? "Walk" : i === 0 ? "Best option" : "Alternative"}
                    </Text>
                    <Text style={styles.routeMeta}>
                      {opt.type === "WALK"
                        ? `${opt.eta_minutes} min walk`
                        : opt.depart_in_minutes <= 1
                        ? `Leave now · ${opt.eta_minutes} min total`
                        : `Leave in ${opt.depart_in_minutes} min · ${opt.eta_minutes} min total`}
                    </Text>
                  </View>
                  <Pressable style={styles.startBtn} onPress={() => onStartNavigation(opt)}>
                    <Text style={styles.startBtnText}>Go</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.depEmpty}>No routes available right now.</Text>
          )}
        </View>
      )}

      {/* Bus stop detail card */}
      {selectedStop && !selectedPlace && (
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>{selectedStop.stop_name}</Text>
            <Text style={styles.detailDistance}>{formatDistance(selectedStop.distance_m)} away</Text>
          </View>
          <Pressable
            style={styles.tripBtn}
            onPress={() => onOpenTrip(selectedStop)}
          >
            <Text style={styles.tripBtnText}>View departures →</Text>
          </Pressable>
          {departuresLoading ? (
            <ActivityIndicator size="small" color="#13294b" style={styles.depLoader} />
          ) : departures.length > 0 ? (
            <ScrollView style={styles.depList} nestedScrollEnabled>
              {departures.slice(0, 8).map((d, i) => (
                <Text key={i} style={styles.depLine}>
                  {d.route} → {d.headsign || "—"} · {d.expected_mins} min
                  {d.is_realtime ? " 🟢" : ""}
                </Text>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.depEmpty}>No departures in the next 60 min.</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1, width: "100%", height: "100%" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#fff" },
  centeredText: { marginTop: 12, fontSize: 16, color: "#666" },
  errorText: { fontSize: 18, fontWeight: "600", color: "#c41e3a" },
  hint: { fontSize: 14, color: "#666", marginTop: 8, textAlign: "center" },
  retryBtn: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 24, backgroundColor: theme.colors.primary, borderRadius: 8 },
  retryBtnSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.primary, marginTop: 8 },
  retryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  retryBtnSecondaryText: { color: theme.colors.primary },
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
    backgroundColor: "#fff",
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  searchInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: 14,
    fontSize: 15,
    color: "#222",
    borderRadius: 10,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  clearBtnText: { fontSize: 14, color: "#999" },
  suggestionList: {
    backgroundColor: "#fff",
    borderRadius: 10,
    marginTop: 4,
    maxHeight: 220,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 6,
  },
  suggestionRow: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  suggestionName: { fontSize: 15, fontWeight: "600", color: "#222" },
  suggestionSub: { fontSize: 12, color: "#888", marginTop: 2 },
  uiucBanner: {
    position: "absolute",
    top: 72,
    left: 16,
    right: 80,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  uiucBannerText: { fontSize: 13, color: theme.colors.textSecondary },
  uiucBannerLink: { fontSize: 13, color: theme.colors.primary, fontWeight: "600" },
  vehicleLegend: {
    position: "absolute",
    top: 72,
    left: 16,
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  vehicleDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#e35205" },
  vehicleLegendText: { fontSize: 12, color: "#333" },
  fallbackTitle: { fontSize: 20, fontWeight: "700", color: "#13294b", marginBottom: 8 },
  fallbackText: { fontSize: 16, color: "#333", textAlign: "center" },
  fallbackHint: { fontSize: 14, color: "#666", marginTop: 12, textAlign: "center" },
  centerBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.radius.md,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  centerBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  detailCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: 16,
    maxHeight: 300,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  detailHeader: { marginBottom: 10 },
  detailTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.primary },
  detailDistance: { fontSize: 14, color: theme.colors.textSecondary, marginTop: 4 },
  routeList: { maxHeight: 200 },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  routeInfo: { flex: 1, marginRight: 12 },
  routeLabel: { fontSize: 15, fontWeight: "600", color: theme.colors.primary },
  routeMeta: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 },
  startBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  startBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  tripBtn: {
    backgroundColor: theme.colors.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  tripBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  depLoader: { marginVertical: 8 },
  depList: { maxHeight: 120 },
  depLine: { fontSize: 14, color: "#333", marginTop: 4 },
  depEmpty: { fontSize: 14, color: "#666", fontStyle: "italic", marginTop: 8 },
});
