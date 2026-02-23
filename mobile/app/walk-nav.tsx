import { fetchBusRouteStops, fetchVehicles, fetchWalkingRoute } from "@/src/api/client";
import type { BusStop, VehicleInfo } from "@/src/api/client";
import { getMpsForMode, WALKING_MODES } from "@/src/constants/walkingMode";
import type { WalkingModeId } from "@/src/constants/walkingMode";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { addActivityEntry, todayDateString } from "@/src/storage/activityLog";
import { MET_BY_MODE, calcCalories } from "@/src/utils/activity";
import { haversineMeters } from "@/src/utils/distance";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { theme } from "@/src/constants/theme";

const WEIGHT_KG = 70; // default weight; could come from settings later
const ARRIVAL_THRESHOLD_M = 30;

type NavPhase = "walking" | "bus";

export default function WalkNavScreen() {
  const router = useRouter();
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const params = useLocalSearchParams<{
    dest_lat: string;
    dest_lng: string;
    dest_name: string;
    walking_mode_id: string;
    route_id: string;
    stop_id: string;
    alighting_stop_id: string;
    alighting_lat: string;
    alighting_lng: string;
  }>();

  const destLat = parseFloat(params.dest_lat ?? "0");
  const destLng = parseFloat(params.dest_lng ?? "0");
  const destName = params.dest_name ?? "Destination";
  const modeId = (params.walking_mode_id ?? "walk") as WalkingModeId;
  const routeId = params.route_id ?? "";
  const boardingStopId = params.stop_id ?? "";
  const alightingStopId = params.alighting_stop_id ?? "";
  const alightingLat = parseFloat(params.alighting_lat ?? "0");
  const alightingLng = parseFloat(params.alighting_lng ?? "0");
  // Bus mode: we have a route and an alighting stop
  const isBusMode = routeId.length > 0 && alightingStopId.length > 0 && alightingLat !== 0;

  const modeLabel = WALKING_MODES.find((m) => m.id === modeId)?.label ?? "Walk";
  const speedMps = getMpsForMode(modeId);

  const [navPhase, setNavPhase] = useState<NavPhase>("walking");
  const [walkingRouteCoords, setWalkingRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [busStops, setBusStops] = useState<BusStop[]>([]);
  const [busShapeCoords, setBusShapeCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [alightingStopName, setAlightingStopName] = useState<string>("");

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [stepCount, setStepCount] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [caloriesBurned, setCaloriesBurned] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [pedometerAvailable, setPedometerAvailable] = useState(false);
  const [encouragement, setEncouragement] = useState<string | null>(null);
  const [busVehicles, setBusVehicles] = useState<VehicleInfo[]>([]);

  const startTimeRef = useRef<number>(Date.now());
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const pedometerSubRef = useRef<{ remove: () => void } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vehiclePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const arrivedRef = useRef(false);
  const walkedDistanceMRef = useRef(0);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const walkingRouteFetchedRef = useRef(false);
  const navPhaseRef = useRef<NavPhase>("walking");
  // Track current target for arrival detection
  const currentTargetRef = useRef<{ lat: number; lng: number }>({ lat: destLat, lng: destLng });

  const mapRef = useRef<MapView | null>(null);

  // Keep navPhaseRef in sync
  useEffect(() => {
    navPhaseRef.current = navPhase;
  }, [navPhase]);

  // Start timer
  useEffect(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setDurationSeconds(elapsed);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Live bus vehicle poll
  useEffect(() => {
    if (!routeId) return;
    const poll = async () => {
      try {
        const res = await fetchVehicles(apiBaseUrl, routeId, { apiKey: apiKey ?? undefined });
        setBusVehicles(res.vehicles ?? []);
      } catch {}
    };
    poll();
    vehiclePollRef.current = setInterval(poll, 15_000);
    return () => {
      if (vehiclePollRef.current) clearInterval(vehiclePollRef.current);
    };
  }, [routeId, apiBaseUrl, apiKey]);

  // Pedometer
  useEffect(() => {
    (async () => {
      const avail = await Pedometer.isAvailableAsync().catch(() => false);
      setPedometerAvailable(avail);
      if (avail) {
        pedometerSubRef.current = Pedometer.watchStepCount((result) => {
          setStepCount(result.steps);
        });
      }
    })();
    return () => {
      pedometerSubRef.current?.remove();
    };
  }, []);

  // Fetch walking route on first GPS fix
  const fetchWalkRoute = useCallback(async (userLat: number, userLng: number) => {
    if (walkingRouteFetchedRef.current) return;
    walkingRouteFetchedRef.current = true;
    try {
      const res = await fetchWalkingRoute(
        apiBaseUrl,
        userLat, userLng,
        destLat, destLng,
        { apiKey: apiKey ?? undefined }
      );
      if (res.coords.length > 1) {
        setWalkingRouteCoords(res.coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
      }
    } catch {}
  }, [apiBaseUrl, apiKey, destLat, destLng]);

  // Fetch bus route data when switching to bus phase
  const fetchBusData = useCallback(async () => {
    if (!isBusMode || !boardingStopId || !alightingStopId) return;
    try {
      const now = new Date();
      const afterTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;
      const res = await fetchBusRouteStops(
        apiBaseUrl,
        routeId,
        boardingStopId,
        alightingStopId,
        afterTime,
        { apiKey: apiKey ?? undefined }
      );
      if (res.stops.length > 0) {
        setBusStops(res.stops);
        const alightStop = res.stops.find((s) => s.stop_id === alightingStopId);
        if (alightStop) setAlightingStopName(alightStop.stop_name);
      }
      if (res.shape_points.length > 1) {
        setBusShapeCoords(res.shape_points.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
      }
    } catch {}
  }, [apiBaseUrl, apiKey, routeId, boardingStopId, alightingStopId, isBusMode]);

  // Location tracking
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Location permission denied. Cannot track walk.");
        return;
      }
      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => {
          if (!mounted) return;
          const { latitude, longitude } = loc.coords;
          setUserLocation({ lat: latitude, lng: longitude });

          // Fetch walking route on first fix
          fetchWalkRoute(latitude, longitude);

          const target = currentTargetRef.current;
          const dist = Math.round(haversineMeters(latitude, longitude, target.lat, target.lng));
          setDistanceM(dist);

          // Accumulate walked distance (ignore GPS jumps > 100 m)
          if (lastPositionRef.current) {
            const delta = haversineMeters(
              lastPositionRef.current.lat,
              lastPositionRef.current.lng,
              latitude,
              longitude
            );
            if (delta < 100) {
              walkedDistanceMRef.current += delta;
              const met = MET_BY_MODE[modeId] ?? 2.8;
              const walkedHours = walkedDistanceMRef.current / speedMps / 3600;
              setCaloriesBurned(calcCalories(met, WEIGHT_KG, walkedHours));
            }
          }
          lastPositionRef.current = { lat: latitude, lng: longitude };

          if (dist <= ARRIVAL_THRESHOLD_M && !arrivedRef.current) {
            const phase = navPhaseRef.current;
            if (isBusMode && phase === "walking") {
              // Arrived at boarding stop — switch to bus phase
              arrivedRef.current = false; // reset so we can detect alighting stop arrival
              setNavPhase("bus");
              currentTargetRef.current = { lat: alightingLat, lng: alightingLng };
              setDistanceM(null);
              fetchBusData();
            } else {
              // Pure walk arrival OR arrived at alighting stop
              arrivedRef.current = true;
              setArrived(true);
            }
          }
        }
      );
    })();
    return () => {
      mounted = false;
      locationSubRef.current?.remove();
    };
  }, [destLat, destLng, isBusMode, alightingLat, alightingLng, fetchWalkRoute, fetchBusData, modeId, speedMps]);

  // Show completion modal on arrival + fetch encouragement
  useEffect(() => {
    if (arrived) {
      if (timerRef.current) clearInterval(timerRef.current);
      setShowCompletion(true);
      (async () => {
        try {
          const base = apiBaseUrl.replace(/\/$/, "");
          const res = await fetch(`${base}/ai/walk-complete`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(apiKey ? { "X-API-Key": apiKey } : {}),
            },
            body: JSON.stringify({
              mode: modeId,
              distance_m: Math.round(walkedDistanceMRef.current),
              calories: caloriesBurned,
              dest_name: destName,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            setEncouragement(data.encouragement ?? null);
          }
        } catch {}
      })();
    }
  }, [arrived, apiBaseUrl, apiKey, modeId, caloriesBurned, destName]);

  const finishWalk = useCallback(async () => {
    await addActivityEntry({
      date: todayDateString(),
      walkingModeId: modeId,
      distanceM: Math.round(walkedDistanceMRef.current),
      stepCount,
      durationSeconds,
      caloriesBurned,
      from: "Current location",
      to: destName,
    });
    setShowCompletion(false);
    router.back();
  }, [modeId, stepCount, durationSeconds, caloriesBurned, destName, router]);

  const onCancel = useCallback(() => {
    locationSubRef.current?.remove();
    pedometerSubRef.current?.remove();
    if (timerRef.current) clearInterval(timerRef.current);
    if (vehiclePollRef.current) clearInterval(vehiclePollRef.current);
    router.back();
  }, [router]);

  const target = currentTargetRef.current;
  const etaSeconds = distanceM != null && speedMps > 0 ? Math.round(distanceM / speedMps) : null;
  const etaMinutes = etaSeconds != null ? Math.ceil(etaSeconds / 60) : null;

  const mapCenter = userLocation ?? { lat: target.lat, lng: target.lng };

  return (
    <View style={styles.container}>
      {Platform.OS !== "web" && (
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          region={{
            latitude: mapCenter.lat,
            longitude: mapCenter.lng,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }}
          showsUserLocation
        >
          {/* Destination marker (boarding stop in walking phase, alighting stop in bus phase) */}
          <Marker
            coordinate={navPhase === "bus"
              ? { latitude: alightingLat, longitude: alightingLng }
              : { latitude: destLat, longitude: destLng }
            }
            title={navPhase === "bus" ? (alightingStopName || "Alighting stop") : destName}
            pinColor={theme.colors.secondary}
          />

          {/* Walking phase: fetched OSRM route or straight-line fallback */}
          {navPhase === "walking" && walkingRouteCoords.length > 1 && (
            <Polyline
              coordinates={walkingRouteCoords}
              strokeColor={theme.colors.primary}
              strokeWidth={3}
            />
          )}
          {navPhase === "walking" && walkingRouteCoords.length <= 1 && userLocation && (
            <Polyline
              coordinates={[
                { latitude: userLocation.lat, longitude: userLocation.lng },
                { latitude: destLat, longitude: destLng },
              ]}
              strokeColor={theme.colors.primary}
              strokeWidth={3}
            />
          )}

          {/* Bus phase: route shape */}
          {navPhase === "bus" && busShapeCoords.length > 1 && (
            <Polyline
              coordinates={busShapeCoords}
              strokeColor={theme.colors.secondary}
              strokeWidth={4}
            />
          )}

          {/* Bus phase: stop markers */}
          {navPhase === "bus" && busStops.map((s) => (
            <Marker
              key={s.stop_id}
              coordinate={{ latitude: s.lat, longitude: s.lng }}
              title={s.stop_name}
              pinColor={s.stop_id === alightingStopId ? "#c41e3a" : "#13294b"}
            />
          ))}

          {/* Live bus vehicles */}
          {busVehicles.map((v) => (
            <Marker
              key={`bus-${v.vehicle_id}`}
              coordinate={{ latitude: v.lat, longitude: v.lng }}
              title={`Bus ${v.route_id}`}
              description={v.headsign || undefined}
              pinColor="#e35205"
            />
          ))}
        </MapView>
      )}

      {/* Board Bus banner (bus mode, walking phase) */}
      {isBusMode && navPhase === "walking" && (
        <View style={styles.boardBusBanner}>
          <Text style={styles.boardBusText}>Walk to stop · Board Bus {routeId}</Text>
        </View>
      )}

      {/* On Bus banner (bus phase) */}
      {navPhase === "bus" && (
        <View style={styles.onBusBanner}>
          <Text style={styles.onBusText}>
            On Bus {routeId} → alight at {alightingStopName || "destination stop"}
          </Text>
        </View>
      )}

      {/* HUD overlay */}
      <View style={styles.hud}>
        {navPhase === "walking" ? (
          <>
            <View style={styles.hudRow}>
              <View style={styles.hudCell}>
                <Text style={styles.hudLabel}>Distance</Text>
                <Text style={styles.hudValue}>
                  {distanceM != null ? `${distanceM} m` : "—"}
                </Text>
              </View>
              <View style={styles.hudCell}>
                <Text style={styles.hudLabel}>ETA</Text>
                <Text style={styles.hudValue}>
                  {etaMinutes != null ? `${etaMinutes} min` : "—"}
                </Text>
              </View>
              <View style={styles.hudCell}>
                <Text style={styles.hudLabel}>Calories</Text>
                <Text style={styles.hudValue}>{caloriesBurned.toFixed(1)}</Text>
              </View>
              {pedometerAvailable && (
                <View style={styles.hudCell}>
                  <Text style={styles.hudLabel}>Steps</Text>
                  <Text style={styles.hudValue}>{stepCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.hudMode}>{modeLabel} mode · {Math.floor(durationSeconds / 60)}m {durationSeconds % 60}s</Text>
            <Text style={styles.hudDest} numberOfLines={1}>→ {destName}</Text>
          </>
        ) : (
          <>
            <View style={styles.hudRow}>
              <View style={styles.hudCell}>
                <Text style={styles.hudLabel}>Dist to stop</Text>
                <Text style={styles.hudValue}>
                  {distanceM != null ? `${distanceM} m` : "—"}
                </Text>
              </View>
              <View style={styles.hudCell}>
                <Text style={styles.hudLabel}>Calories</Text>
                <Text style={styles.hudValue}>{caloriesBurned.toFixed(1)}</Text>
              </View>
              {pedometerAvailable && (
                <View style={styles.hudCell}>
                  <Text style={styles.hudLabel}>Steps</Text>
                  <Text style={styles.hudValue}>{stepCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.hudMode}>Bus {routeId} · {Math.floor(durationSeconds / 60)}m {durationSeconds % 60}s</Text>
            <Text style={styles.hudDest} numberOfLines={1}>
              Alight at {alightingStopName || alightingStopId || "destination"}
            </Text>
          </>
        )}
      </View>

      {locationError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{locationError}</Text>
        </View>
      )}

      <Pressable style={styles.cancelBtn} onPress={onCancel}>
        <Text style={styles.cancelBtnText}>✕ Cancel walk</Text>
      </Pressable>

      {/* Completion modal */}
      <Modal visible={showCompletion} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>You arrived!</Text>
            <Text style={styles.modalDest}>{destName}</Text>
            <View style={styles.modalStats}>
              <Text style={styles.modalStat}>🚶 {Math.round(walkedDistanceMRef.current)} m</Text>
              <Text style={styles.modalStat}>⏱ {Math.floor(durationSeconds / 60)}m {durationSeconds % 60}s</Text>
              <Text style={styles.modalStat}>🔥 {caloriesBurned.toFixed(1)} kcal</Text>
              {pedometerAvailable && <Text style={styles.modalStat}>👣 {stepCount} steps</Text>}
            </View>
            {encouragement && (
              <Text style={styles.encouragementText}>{encouragement}</Text>
            )}
            <Pressable style={styles.modalBtn} onPress={finishWalk}>
              <Text style={styles.modalBtnText}>Save & finish</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  boardBusBanner: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 120,
    backgroundColor: "rgba(19,41,75,0.88)",
    padding: 10,
    borderRadius: 8,
  },
  boardBusText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  onBusBanner: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 120,
    backgroundColor: "rgba(227,82,5,0.92)",
    padding: 10,
    borderRadius: 8,
  },
  onBusText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  hud: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(19,41,75,0.92)",
    padding: 16,
    paddingBottom: 32,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  hudRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 8 },
  hudCell: { alignItems: "center" },
  hudLabel: { fontSize: 11, color: "rgba(255,255,255,0.7)", marginBottom: 2 },
  hudValue: { fontSize: 20, fontWeight: "700", color: "#fff" },
  hudMode: { fontSize: 13, color: "rgba(255,255,255,0.8)", textAlign: "center", marginBottom: 4 },
  hudDest: { fontSize: 14, color: "#e35205", fontWeight: "600", textAlign: "center" },
  cancelBtn: {
    position: "absolute",
    top: 48,
    right: 16,
    backgroundColor: "rgba(196,30,58,0.9)",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  cancelBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  errorBanner: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 120,
    backgroundColor: "#c41e3a",
    padding: 10,
    borderRadius: 8,
  },
  errorBannerText: { color: "#fff", fontSize: 13 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    alignItems: "center",
  },
  modalTitle: { fontSize: 24, fontWeight: "700", color: theme.colors.primary, marginBottom: 4 },
  modalDest: { fontSize: 16, color: theme.colors.textSecondary, marginBottom: 16 },
  modalStats: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", marginBottom: 20 },
  modalStat: { fontSize: 18, fontWeight: "600", color: theme.colors.text },
  encouragementText: {
    fontSize: 14,
    color: theme.colors.secondary,
    fontStyle: "italic",
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  modalBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  modalBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
