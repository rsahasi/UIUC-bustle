import { fetchBusRouteStops, fetchVehicles, fetchWalkingRoute } from "@/src/api/client";
import type { BusStop, VehicleInfo } from "@/src/api/client";
import { getMpsForMode, WALKING_MODES } from "@/src/constants/walkingMode";
import type { WalkingModeId } from "@/src/constants/walkingMode";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useRecommendationSettings } from "@/src/hooks/useRecommendationSettings";
import { addActivityEntry, todayDateString } from "@/src/storage/activityLog";
import { MET_BY_MODE, calcCalories } from "@/src/utils/activity";
import { formatDistance, haversineMeters } from "@/src/utils/distance";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Bus, Flame, Footprints, Timer, X } from "lucide-react-native";
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
import { getEntranceCoords } from "@/src/utils/buildingEntrance";

const ARRIVAL_THRESHOLD_M = 30;
const OFF_ROUTE_THRESHOLD_M = 120;

/** Minimum distance (meters) from point (pLat, pLng) to a line segment [(aLat,aLng)-(bLat,bLng)] */
function distToSegmentM(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number
): number {
  const dx = bLng - aLng, dy = bLat - aLat;
  if (dx === 0 && dy === 0) return haversineMeters(pLat, pLng, aLat, aLng);
  const t = Math.max(0, Math.min(1, ((pLng - aLng) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy)));
  return haversineMeters(pLat, pLng, aLat + t * dy, aLng + t * dx);
}

function minDistToPolylineM(lat: number, lng: number, coords: { latitude: number; longitude: number }[]): number {
  if (coords.length === 0) return Infinity;
  if (coords.length === 1) return haversineMeters(lat, lng, coords[0].latitude, coords[0].longitude);
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distToSegmentM(lat, lng, coords[i].latitude, coords[i].longitude, coords[i + 1].latitude, coords[i + 1].longitude);
    if (d < min) min = d;
  }
  return min;
}

type NavPhase = "walking" | "bus";

export default function WalkNavScreen() {
  const router = useRouter();
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { weightKg } = useRecommendationSettings();
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
    building_id: string;
    arrive_by_class_time: string;
    bus_dep_epoch_ms: string;
    final_lat: string;
    final_lng: string;
    final_name: string;
  }>();

  const buildingId = params.building_id ?? "";
  const entranceOverride = buildingId ? getEntranceCoords(buildingId) : null;
  const destLat = entranceOverride ? entranceOverride.lat : parseFloat(params.dest_lat ?? "0");
  const destLng = entranceOverride ? entranceOverride.lng : parseFloat(params.dest_lng ?? "0");
  const destName = params.dest_name ?? "Destination";
  const finalDestLat = parseFloat(params.final_lat ?? "0");
  const finalDestLng = parseFloat(params.final_lng ?? "0");
  const finalDestName = params.final_name ?? destName;
  const hasFinalDest = finalDestLat !== 0 && finalDestLng !== 0;
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
  const [entranceDesc] = useState<string | null>(entranceOverride?.desc ?? null);
  const [busDepEpochMs] = useState<number | null>(
    params.bus_dep_epoch_ms ? parseInt(params.bus_dep_epoch_ms, 10) : null
  );
  const [busMissed, setBusMissed] = useState(false);

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

  const [zoomDelta, setZoomDelta] = useState(0.005);
  const zoomIn = () => setZoomDelta((d) => Math.max(d / 2, 0.0003));
  const zoomOut = () => setZoomDelta((d) => Math.min(d * 2, 0.5));

  const mapRef = useRef<MapView | null>(null);
  const walkingRouteCoordsRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const offRouteRefetchRef = useRef(false);

  // Keep navPhaseRef in sync
  useEffect(() => {
    navPhaseRef.current = navPhase;
  }, [navPhase]);

  // Keep walkingRouteCoordsRef in sync
  useEffect(() => {
    walkingRouteCoordsRef.current = walkingRouteCoords;
  }, [walkingRouteCoords]);

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
    vehiclePollRef.current = setInterval(poll, 8_000);
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

  // Fetch walking route on first GPS fix or when off-route
  const fetchWalkRoute = useCallback(async (userLat: number, userLng: number, force = false) => {
    if (walkingRouteFetchedRef.current && !force) return;
    walkingRouteFetchedRef.current = true;
    // Snap origin to UIUC if GPS is far away (simulator default = San Francisco)
    const UIUC_LAT = 40.102, UIUC_LNG = -88.2272;
    const distToUiuc = Math.sqrt((userLat - UIUC_LAT) ** 2 + (userLng - UIUC_LNG) ** 2) * 111_000;
    const origLat = distToUiuc > 100_000 ? UIUC_LAT : userLat;
    const origLng = distToUiuc > 100_000 ? UIUC_LNG : userLng;
    try {
      const res = await fetchWalkingRoute(
        apiBaseUrl,
        origLat, origLng,
        destLat, destLng,
        { apiKey: apiKey ?? undefined }
      );
      if (res.coords.length > 1) {
        setWalkingRouteCoords(res.coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
      }
    } catch {}
  }, [apiBaseUrl, apiKey, destLat, destLng]);

  // Fetch bus route shape + stops; used both at mount (preview) and on phase switch
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
      } else {
        // GTFS shape unavailable — use OSRM road-following route as fallback
        const walk = await fetchWalkingRoute(
          apiBaseUrl, destLat, destLng, alightingLat, alightingLng,
          { apiKey: apiKey ?? undefined }
        );
        if (walk.coords.length > 1) {
          setBusShapeCoords(walk.coords.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
        }
      }
    } catch {}
  }, [apiBaseUrl, apiKey, routeId, boardingStopId, alightingStopId, isBusMode, destLat, destLng, alightingLat, alightingLng]);

  // Eagerly fetch bus shape at mount so it's visible during the walking phase
  useEffect(() => {
    if (isBusMode) fetchBusData();
  }, [isBusMode, fetchBusData]);

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
          let { latitude, longitude } = loc.coords;
          // Snap to UIUC if GPS is far away (simulator default = San Francisco)
          if (haversineMeters(latitude, longitude, 40.102, -88.2272) > 100_000) {
            latitude = 40.102;
            longitude = -88.2272;
          }
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
              setCaloriesBurned(calcCalories(met, weightKg, walkedHours));
            }
          }
          lastPositionRef.current = { lat: latitude, lng: longitude };

          // Missed bus detection
          if (busDepEpochMs && navPhaseRef.current === "walking" && Date.now() > busDepEpochMs + 30000 && !busMissed) {
            setBusMissed(true);
          }

          // Off-route detection: if >120m from polyline, re-fetch OSRM route
          if (
            navPhaseRef.current === "walking" &&
            !arrivedRef.current &&
            !offRouteRefetchRef.current &&
            walkingRouteCoordsRef.current.length > 1
          ) {
            const distToRoute = minDistToPolylineM(latitude, longitude, walkingRouteCoordsRef.current);
            if (distToRoute > OFF_ROUTE_THRESHOLD_M) {
              offRouteRefetchRef.current = true;
              walkingRouteFetchedRef.current = false;
              fetchWalkRoute(latitude, longitude, true).finally(() => {
                offRouteRefetchRef.current = false;
              });
            }
          }

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
  }, [destLat, destLng, isBusMode, alightingLat, alightingLng, fetchWalkRoute, fetchBusData, modeId, speedMps, weightKg]);

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

  // Pace warning calculation
  const classStartTime = params.arrive_by_class_time as string | undefined;
  let paceStatus: 'on-track' | 'behind' | 'ahead' | null = null;
  let minsUntilClass: number | null = null;
  if (classStartTime && etaMinutes != null) {
    const now = new Date();
    const [h, m] = classStartTime.split(':').map(Number);
    const classMs = new Date().setHours(h, m, 0, 0);
    minsUntilClass = (classMs - now.getTime()) / 60000;
    const marginMins = minsUntilClass - etaMinutes;
    if (marginMins < -1) paceStatus = 'behind';
    else if (marginMins > 3) paceStatus = 'ahead';
    else paceStatus = 'on-track';
  }

  // Snap map center to UIUC if GPS is far away (simulator default = San Francisco)
  const UIUC_CENTER = { lat: 40.102, lng: -88.2272 };
  const rawCenter = userLocation ?? { lat: target.lat, lng: target.lng };
  const rawDistToUiuc = Math.sqrt((rawCenter.lat - UIUC_CENTER.lat) ** 2 + (rawCenter.lng - UIUC_CENTER.lng) ** 2) * 111_000;
  const mapCenter = rawDistToUiuc > 100_000 ? { lat: target.lat, lng: target.lng } : rawCenter;

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
            latitudeDelta: zoomDelta,
            longitudeDelta: zoomDelta,
          }}
        >
          {/* User location — blue dot using snapped coords so it shows on UIUC map */}
          {userLocation && (
            <Marker
              coordinate={{ latitude: userLocation.lat, longitude: userLocation.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={styles.userDot} />
            </Marker>
          )}

          {/* Intermediate target marker (boarding stop or alighting stop) */}
          <Marker
            coordinate={navPhase === "bus"
              ? { latitude: alightingLat, longitude: alightingLng }
              : { latitude: destLat, longitude: destLng }
            }
            title={navPhase === "bus" ? (alightingStopName || "Alighting stop") : destName}
            pinColor={theme.colors.secondary}
          />

          {/* Final destination — always visible */}
          {hasFinalDest && (
            <Marker
              coordinate={{ latitude: finalDestLat, longitude: finalDestLng }}
              title={finalDestName}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
            >
              <View style={styles.finalDestPin}>
                <View style={styles.finalDestPinHead} />
                <View style={styles.finalDestPinTail} />
              </View>
            </Marker>
          )}

          {/* Walking phase: fetched OSRM route or straight-line fallback */}
          {navPhase === "walking" && walkingRouteCoords.length > 1 && (
            <Polyline
              coordinates={walkingRouteCoords}
              strokeColor="rgba(29, 111, 240, 1)"
              strokeWidth={2}
              lineDashPattern={[6, 4]}
              zIndex={10}
            />
          )}
          {navPhase === "walking" && walkingRouteCoords.length <= 1 && userLocation && (
            <Polyline
              coordinates={[
                { latitude: userLocation.lat, longitude: userLocation.lng },
                { latitude: destLat, longitude: destLng },
              ]}
              strokeColor="rgba(29, 111, 240, 1)"
              strokeWidth={2}
              lineDashPattern={[6, 4]}
              zIndex={10}
            />
          )}

          {/* Bus route shape — visible in BOTH walking and bus phases */}
          {isBusMode && busShapeCoords.length > 1 && (
            <Polyline
              coordinates={busShapeCoords}
              strokeColor="rgba(29, 111, 240, 1)"
              strokeWidth={4}
              zIndex={10}
            />
          )}

          {/* Bus phase: stop markers */}
          {navPhase === "bus" && busStops.map((s) => (
            <Marker
              key={s.stop_id}
              coordinate={{ latitude: s.lat, longitude: s.lng }}
              title={s.stop_name}
              pinColor={s.stop_id === alightingStopId ? theme.colors.error : theme.colors.navy}
            />
          ))}

          {/* Live bus vehicles — navy circle with white Bus icon */}
          {busVehicles.map((v) => (
            <Marker
              key={`bus-${v.vehicle_id}`}
              coordinate={{ latitude: v.lat, longitude: v.lng }}
              title={`Bus ${v.route_id}`}
              description={v.headsign || undefined}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={styles.busMarker}>
                <Bus size={14} color="#fff" strokeWidth={2.5} />
              </View>
            </Marker>
          ))}
        </MapView>
      )}

      {/* Zoom controls */}
      <View style={styles.zoomControls}>
        <Pressable style={styles.zoomBtn} onPress={zoomIn} accessibilityLabel="Zoom in">
          <Text style={styles.zoomBtnText}>+</Text>
        </Pressable>
        <View style={styles.zoomDivider} />
        <Pressable style={styles.zoomBtn} onPress={zoomOut} accessibilityLabel="Zoom out">
          <Text style={styles.zoomBtnText}>−</Text>
        </Pressable>
      </View>

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

      {/* Missed bus banner */}
      {busMissed && (
        <View style={styles.missedBusBanner}>
          <Text style={styles.missedBusText}>Bus departed — continue walking to destination</Text>
          <Pressable onPress={() => setBusMissed(false)} style={styles.missedBusDismiss}>
            <Text style={styles.missedBusDismissText}>Got it</Text>
          </Pressable>
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
                  {distanceM != null ? formatDistance(distanceM) : "—"}
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
            {entranceDesc != null && (
              <Text style={styles.entranceNotice}>→ {entranceDesc}</Text>
            )}
            {paceStatus === 'behind' && etaMinutes != null && minsUntilClass != null && (
              <Text style={styles.paceWarning}>Behind pace — {Math.abs(Math.round(minsUntilClass - etaMinutes))} min late at this speed</Text>
            )}
            {paceStatus === 'ahead' && (
              <Text style={styles.paceAhead}>On track — arriving early</Text>
            )}
          </>
        ) : (
          <>
            <View style={styles.hudRow}>
              <View style={styles.hudCell}>
                <Text style={styles.hudLabel}>Dist to stop</Text>
                <Text style={styles.hudValue}>
                  {distanceM != null ? formatDistance(distanceM) : "—"}
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

      <Pressable style={[styles.cancelBtn, { flexDirection: "row", alignItems: "center", gap: 4 }]} onPress={onCancel}>
        <X size={14} color="#fff" />
        <Text style={styles.cancelBtnText}>Cancel walk</Text>
      </Pressable>

      {/* Completion modal */}
      <Modal visible={showCompletion} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>You arrived!</Text>
            <Text style={styles.modalDest}>{destName}</Text>
            <View style={styles.modalStats}>
              <View style={styles.modalStatRow}>
                <Footprints size={18} color={theme.colors.text} />
                <Text style={styles.modalStat}>{formatDistance(walkedDistanceMRef.current)}</Text>
              </View>
              <View style={styles.modalStatRow}>
                <Timer size={18} color={theme.colors.text} />
                <Text style={styles.modalStat}>{Math.floor(durationSeconds / 60)}m {durationSeconds % 60}s</Text>
              </View>
              <View style={styles.modalStatRow}>
                <Flame size={18} color={theme.colors.text} />
                <Text style={styles.modalStat}>{caloriesBurned.toFixed(1)} kcal</Text>
              </View>
              {pedometerAvailable && (
                <View style={styles.modalStatRow}>
                  <Footprints size={18} color={theme.colors.text} />
                  <Text style={styles.modalStat}>{stepCount} steps</Text>
                </View>
              )}
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
  userDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#2196F3",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  busMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.navy,
    borderWidth: 2,
    borderColor: theme.colors.orange,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  boardBusBanner: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 120,
    backgroundColor: "rgba(19,41,75,0.88)",
    padding: 10,
    borderRadius: 8,
  },
  boardBusText: { color: "#fff", fontSize: 13, fontFamily: "DMSans_600SemiBold" },
  onBusBanner: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 120,
    backgroundColor: "rgba(232,74,39,0.92)",
    padding: 10,
    borderRadius: theme.radius.md,
  },
  onBusText: { color: "#fff", fontSize: 13, fontFamily: "DMSans_600SemiBold" },
  hud: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(19,41,75,0.92)",
    padding: 16,
    paddingBottom: 32,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
  },
  hudRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 8 },
  hudCell: { alignItems: "center" },
  hudLabel: { fontSize: 11, fontFamily: "DMSans_400Regular", color: "rgba(255,255,255,0.7)", marginBottom: 2 },
  hudValue: { fontSize: 20, fontFamily: "DMSans_700Bold", color: "#fff" },
  hudMode: { fontSize: 13, fontFamily: "DMSans_400Regular", color: "rgba(255,255,255,0.8)", textAlign: "center", marginBottom: 4 },
  hudDest: { fontSize: 14, fontFamily: "DMSans_600SemiBold", color: theme.colors.orange, textAlign: "center" },
  cancelBtn: {
    position: "absolute",
    top: 48,
    right: 16,
    backgroundColor: "rgba(220,38,38,0.9)",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: theme.radius.md,
  },
  cancelBtnText: { color: "#fff", fontFamily: "DMSans_600SemiBold", fontSize: 14 },
  errorBanner: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 120,
    backgroundColor: theme.colors.error,
    padding: 10,
    borderRadius: theme.radius.md,
  },
  errorBannerText: { color: "#fff", fontSize: 13, fontFamily: "DMSans_400Regular" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 24,
    width: "100%",
    alignItems: "center",
  },
  modalTitle: { fontSize: 24, fontFamily: "DMSans_700Bold", color: theme.colors.primary, marginBottom: 4 },
  modalDest: { fontSize: 16, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginBottom: 16 },
  modalStats: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", marginBottom: 20 },
  modalStatRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  modalStat: { fontSize: 18, fontFamily: "DMSans_600SemiBold", color: theme.colors.text },
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
  modalBtnText: { color: "#fff", fontSize: 16, fontFamily: "DMSans_700Bold" },
  entranceNotice: { fontSize: 11, fontFamily: "DMSans_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 2, textAlign: "center" },
  paceWarning: { fontSize: 12, fontFamily: "DMSans_600SemiBold", color: theme.colors.error, backgroundColor: "rgba(220,38,38,0.15)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginTop: 4, textAlign: "center" },
  paceAhead: { fontSize: 11, fontFamily: "DMSans_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 2, textAlign: "center" },
  missedBusBanner: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: theme.colors.error, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 20 },
  missedBusText: { fontSize: 13, fontFamily: "DMSans_600SemiBold", color: "#fff", flex: 1 },
  missedBusDismiss: { paddingHorizontal: 10, paddingVertical: 4 },
  missedBusDismissText: { fontSize: 13, fontFamily: "DMSans_600SemiBold", color: "#fff" },
  zoomControls: {
    position: "absolute",
    top: 104,
    right: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 10,
  },
  zoomBtn: { width: 44, height: 42, alignItems: "center", justifyContent: "center" },
  zoomBtnText: { fontSize: 22, fontFamily: "DMSans_400Regular", color: theme.colors.navy, lineHeight: 26 },
  zoomDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginHorizontal: 8 },
  finalDestPin: { alignItems: "center" },
  finalDestPinHead: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(29, 111, 240, 1)",
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  finalDestPinTail: {
    width: 2.5,
    height: 8,
    backgroundColor: "rgba(29, 111, 240, 1)",
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
});
