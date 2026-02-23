import { fetchDepartures, fetchNearbyStops, fetchVehicles } from "@/src/api/client";
import type { DepartureItem, StopInfo, VehicleInfo } from "@/src/api/types";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { haversineMeters } from "@/src/utils/distance";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "denied" | "error" | "ready">("loading");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [stops, setStops] = useState<StopWithDistance[]>([]);
  const [selectedStop, setSelectedStop] = useState<StopWithDistance | null>(null);
  const [departures, setDepartures] = useState<DepartureItem[]>([]);
  const [departuresLoading, setDeparturesLoading] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleInfo[]>([]);
  const [useUiucArea, setUseUiucArea] = useState(false);
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

  const onMarkerPress = useCallback(
    async (stop: StopWithDistance) => {
      setSelectedStop(stop);
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
      >
        {stops.map((stop) => (
          <Marker
            key={stop.stop_id}
            coordinate={{ latitude: stop.lat, longitude: stop.lng }}
            title={stop.stop_name}
            description={`${stop.distance_m} m away`}
            onPress={() => onMarkerPress(stop)}
            pinColor={selectedStop?.stop_id === stop.stop_id ? "#13294b" : "#c41e3a"}
          />
        ))}
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
      {selectedStop && (
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>{selectedStop.stop_name}</Text>
            <Text style={styles.detailDistance}>{selectedStop.distance_m} m away</Text>
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
  uiucBanner: {
    position: "absolute",
    top: 16,
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
    top: 56,
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
    maxHeight: 280,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  detailHeader: { marginBottom: 8 },
  detailTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.primary },
  detailDistance: { fontSize: 14, color: theme.colors.textSecondary, marginTop: 4 },
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
  depEmpty: { fontSize: 14, color: "#666", fontStyle: "italic" },
});
