import { fetchDepartures } from "@/src/api/client";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const REFRESH_INTERVAL_MS = 25000;

export default function TripScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { stop_id, stop_name } = useLocalSearchParams<{ stop_id: string; stop_name?: string }>();
  const router = useRouter();
  const [departures, setDepartures] = useState<{ route: string; headsign: string; expected_mins: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!stop_id) return;
    setLoadError(false);
    try {
      const res = await fetchDepartures(apiBaseUrl, stop_id, 60, { apiKey: apiKey ?? undefined });
      setDepartures((res.departures ?? []).slice(0, 15));
    } catch {
      setDepartures([]);
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl, apiKey, stop_id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!stop_id) return;
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [stop_id, load]);

  const onWalkInstead = useCallback(() => {
    router.replace("/(tabs)?highlight=walk" as any);
  }, [router]);

  if (!stop_id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Missing stop</Text>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.btn}
        >
          <Text style={styles.btnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#13294b" />
      }
    >
      <View style={styles.header}>
        <Text style={styles.stopName}>{stop_name || stop_id}</Text>
        <Text style={styles.subtitle}>Live departures (updates every 25s)</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#13294b" style={styles.loader} />
      ) : loadError ? (
        <View style={styles.errorBlock}>
          <Text style={styles.empty}>Couldn’t load departures. Pull down to refresh.</Text>
        </View>
      ) : departures.length === 0 ? (
        <Text style={styles.empty}>No departures right now.</Text>
      ) : (
        <View style={styles.list}>
          {departures.map((d, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.route}>{d.route}</Text>
              <Text style={styles.headsign}>{d.headsign || "—"}</Text>
              <Text style={styles.mins}>{d.expected_mins} min</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable
        accessibilityLabel="I'll walk instead, go back to Home"
        accessibilityRole="button"
        onPress={onWalkInstead}
        style={styles.walkBtn}
      >
        <Text style={styles.walkBtnText}>I'll walk instead</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  container: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 16 },
  stopName: { fontSize: 22, fontWeight: "700", color: "#13294b" },
  subtitle: { fontSize: 14, color: "#666", marginTop: 4 },
  loader: { marginVertical: 24 },
  empty: { fontSize: 16, color: "#666", marginVertical: 16 },
  errorBlock: { marginVertical: 16 },
  list: { marginBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    marginBottom: 8,
  },
  route: { fontSize: 18, fontWeight: "600", width: 48 },
  headsign: { flex: 1, fontSize: 16, color: "#333" },
  mins: { fontSize: 16, color: "#13294b", fontWeight: "600" },
  walkBtn: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#13294b",
    alignItems: "center",
  },
  walkBtnText: { fontSize: 16, fontWeight: "600", color: "#13294b" },
  error: { fontSize: 16, color: "#c41e3a", marginBottom: 12 },
  btn: { padding: 12, backgroundColor: "#13294b", borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "600" },
});
