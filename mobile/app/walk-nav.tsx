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

export default function WalkNavScreen() {
  const router = useRouter();
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const params = useLocalSearchParams<{
    dest_lat: string;
    dest_lng: string;
    dest_name: string;
    walking_mode_id: string;
  }>();

  const destLat = parseFloat(params.dest_lat ?? "0");
  const destLng = parseFloat(params.dest_lng ?? "0");
  const destName = params.dest_name ?? "Destination";
  const modeId = (params.walking_mode_id ?? "walk") as WalkingModeId;
  const modeLabel = WALKING_MODES.find((m) => m.id === modeId)?.label ?? "Walk";
  const speedMps = getMpsForMode(modeId);

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

  const startTimeRef = useRef<number>(Date.now());
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const pedometerSubRef = useRef<{ remove: () => void } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const arrivedRef = useRef(false);
  const walkedDistanceMRef = useRef(0);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  const mapRef = useRef<MapView | null>(null);

  // Start timer (duration only — calories are derived from walked distance)
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
          const dist = Math.round(haversineMeters(latitude, longitude, destLat, destLng));
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
            arrivedRef.current = true;
            setArrived(true);
          }
        }
      );
    })();
    return () => {
      mounted = false;
      locationSubRef.current?.remove();
    };
  }, [destLat, destLng]);

  // Show completion modal on arrival + fetch encouragement
  useEffect(() => {
    if (arrived) {
      if (timerRef.current) clearInterval(timerRef.current);
      setShowCompletion(true);
      // Fetch AI encouragement
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
  }, [arrived, apiBaseUrl, apiKey, modeId, distanceM, caloriesBurned, destName]);

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
    router.back();
  }, [router]);

  const etaSeconds = distanceM != null && speedMps > 0 ? Math.round(distanceM / speedMps) : null;
  const etaMinutes = etaSeconds != null ? Math.ceil(etaSeconds / 60) : null;

  const mapCenter = userLocation ?? { lat: destLat, lng: destLng };

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
          <Marker
            coordinate={{ latitude: destLat, longitude: destLng }}
            title={destName}
            pinColor={theme.colors.secondary}
          />
          {userLocation && (
            <Polyline
              coordinates={[
                { latitude: userLocation.lat, longitude: userLocation.lng },
                { latitude: destLat, longitude: destLng },
              ]}
              strokeColor={theme.colors.primary}
              strokeWidth={3}
            />
          )}
        </MapView>
      )}

      {/* HUD overlay */}
      <View style={styles.hud}>
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
