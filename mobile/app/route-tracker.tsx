import { fetchAllStopsForRoute, fetchVehicles } from "@/src/api/client";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { theme } from "@/src/constants/theme";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const VEHICLE_POLL_MS = 10_000;

interface BusStop {
  stop_id: string;
  stop_name: string;
  lat: number;
  lng: number;
  sequence: number;
}

interface Vehicle {
  vehicle_id: string;
  lat: number;
  lng: number;
  route_id: string;
  heading?: number;
}

export default function RouteTrackerScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { route_id, route_name } = useLocalSearchParams<{ route_id: string; route_name?: string }>();
  const router = useRouter();

  const [stops, setStops] = useState<BusStop[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStops = useCallback(async () => {
    if (!route_id) return;
    setError(null);
    try {
      const res = await fetchAllStopsForRoute(apiBaseUrl, route_id, { apiKey: apiKey ?? undefined });
      setStops(res.stops ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load route");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl, apiKey, route_id]);

  const loadVehicles = useCallback(async () => {
    if (!route_id) return;
    try {
      const res = await fetchVehicles(apiBaseUrl, route_id, { apiKey: apiKey ?? undefined });
      setVehicles((res.vehicles ?? []) as Vehicle[]);
    } catch {
      // Vehicle data is best-effort
    }
  }, [apiBaseUrl, apiKey, route_id]);

  useEffect(() => {
    loadStops();
    loadVehicles();
  }, [loadStops, loadVehicles]);

  useEffect(() => {
    vehicleIntervalRef.current = setInterval(loadVehicles, VEHICLE_POLL_MS);
    return () => {
      if (vehicleIntervalRef.current) clearInterval(vehicleIntervalRef.current);
    };
  }, [loadVehicles]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadStops();
    loadVehicles();
  }, [loadStops, loadVehicles]);

  if (!route_id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No route specified.</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const displayName = route_name ? `${route_id} — ${route_name}` : `Route ${route_id}`;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.orange} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.routeBadge}>
          <Text style={styles.routeBadgeText}>{route_id}</Text>
        </View>
        <View style={styles.headerTextCol}>
          <Text style={styles.headerTitle}>{route_name || `Route ${route_id}`}</Text>
          <Text style={styles.headerSub}>{stops.length} stops · updates every 10s</Text>
        </View>
      </View>

      {/* Live vehicles */}
      {vehicles.length > 0 && (
        <View style={styles.vehiclesBanner}>
          <View style={styles.liveDot} />
          <Text style={styles.vehiclesText}>
            {vehicles.length} bus{vehicles.length !== 1 ? "es" : ""} active on this route
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="large" color={theme.colors.orange} style={styles.loader} />
      ) : error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={onRefresh}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : stops.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyText}>No stop data found for this route.</Text>
          <Text style={styles.emptyHint}>GTFS data may not be loaded. Run the load_gtfs.py script.</Text>
        </View>
      ) : (
        <View style={styles.stopList}>
          {stops.map((stop, i) => {
            const isFirst = i === 0;
            const isLast = i === stops.length - 1;
            // Find if any vehicle is near this stop (within ~200m)
            const hasVehicleNearby = vehicles.some((v) => {
              const dlat = v.lat - stop.lat;
              const dlng = v.lng - stop.lng;
              return Math.sqrt(dlat * dlat + dlng * dlng) * 111_000 < 200;
            });

            return (
              <View key={stop.stop_id} style={styles.stopRow}>
                {/* Timeline line + dot */}
                <View style={styles.timeline}>
                  <View style={[styles.timelineLine, styles.timelineLineTop, isFirst && styles.timelineLineHidden]} />
                  <View style={[styles.timelineDot, hasVehicleNearby && styles.timelineDotActive]} />
                  <View style={[styles.timelineLine, styles.timelineLineBottom, isLast && styles.timelineLineHidden]} />
                </View>

                {/* Stop info */}
                <View style={styles.stopInfo}>
                  <Text style={[styles.stopName, (isFirst || isLast) && styles.stopNameTerminus]}>
                    {stop.stop_name}
                  </Text>
                  {(isFirst || isLast) && (
                    <Text style={styles.terminusLabel}>{isFirst ? "First stop" : "Last stop"}</Text>
                  )}
                  {hasVehicleNearby && (
                    <View style={styles.vehicleHereBadge}>
                      <View style={styles.vehicleHereDot} />
                      <Text style={styles.vehicleHereText}>Bus here</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const TIMELINE_W = 32;

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  container: { paddingBottom: 40 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.navy,
    padding: theme.spacing.lg,
    gap: 14,
  },
  routeBadge: {
    backgroundColor: theme.colors.orange,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 48,
    alignItems: "center",
  },
  routeBadgeText: { fontFamily: "DMSans_700Bold", fontSize: 20, color: "#fff" },
  headerTextCol: { flex: 1 },
  headerTitle: { fontFamily: "DMSans_700Bold", fontSize: 18, color: "#fff" },
  headerSub: { fontFamily: "DMSans_400Regular", fontSize: 13, color: "rgba(255,255,255,0.65)", marginTop: 2 },

  vehiclesBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: 8,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.orange },
  vehiclesText: { fontFamily: "DMSans_500Medium", fontSize: 13, color: theme.colors.text },

  loader: { marginTop: 40 },

  errorBlock: { padding: theme.spacing.lg, alignItems: "center" },
  errorText: { fontFamily: "DMSans_400Regular", fontSize: 15, color: theme.colors.error, marginBottom: 12 },
  retryBtn: { backgroundColor: theme.colors.navy, borderRadius: theme.radius.sm, paddingVertical: 10, paddingHorizontal: 20 },
  retryBtnText: { fontFamily: "DMSans_600SemiBold", fontSize: 14, color: "#fff" },

  emptyBlock: { padding: theme.spacing.lg },
  emptyText: { fontFamily: "DMSans_400Regular", fontSize: 15, color: theme.colors.textSecondary, marginBottom: 6 },
  emptyHint: { fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.colors.textMuted },

  backBtn: { marginTop: 16, backgroundColor: theme.colors.navy, borderRadius: theme.radius.sm, paddingVertical: 10, paddingHorizontal: 20 },
  backBtnText: { fontFamily: "DMSans_600SemiBold", fontSize: 14, color: "#fff" },

  // Stop list
  stopList: { paddingTop: 8, paddingBottom: 8 },
  stopRow: {
    flexDirection: "row",
    minHeight: 52,
  },

  // Timeline column
  timeline: {
    width: TIMELINE_W + theme.spacing.lg,
    alignItems: "center",
    paddingLeft: theme.spacing.lg,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: theme.colors.border,
  },
  timelineLineTop: {},
  timelineLineBottom: {},
  timelineLineHidden: { backgroundColor: "transparent" },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.navy,
    borderWidth: 2,
    borderColor: theme.colors.navy,
    marginVertical: 2,
  },
  timelineDotActive: {
    backgroundColor: theme.colors.orange,
    borderColor: theme.colors.orange,
    width: 14,
    height: 14,
    borderRadius: 7,
  },

  // Stop info column
  stopInfo: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  stopName: {
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    color: theme.colors.text,
  },
  stopNameTerminus: {
    fontFamily: "DMSans_600SemiBold",
    color: theme.colors.navy,
  },
  terminusLabel: {
    fontFamily: "DMSans_400Regular",
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 1,
  },
  vehicleHereBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  vehicleHereDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.orange },
  vehicleHereText: { fontFamily: "DMSans_600SemiBold", fontSize: 11, color: theme.colors.orange },
});
