import { fetchDepartures } from "@/src/api/client";
import { FadeInView, PressableScale, PulseView } from "@/src/components/ui/motion";
import { theme } from "@/src/constants/theme";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
        <PressableScale
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.btn}
        >
          <Text style={styles.btnText}>Back</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#13294b" />
      }
    >
      <FadeInView delay={0} style={styles.card}>
        <LinearGradient
          colors={[theme.gradients.ember[0], theme.gradients.ember[1]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardHeader}
        >
          <Text style={styles.stopName}>{stop_name || stop_id}</Text>
          <View style={styles.accentUnderline} />
          <View style={styles.liveRow}>
            <PulseView minOpacity={0.3} maxScale={1.4} duration={900} style={styles.liveDot} />
            <Text style={styles.subtitle}>Live departures (updates every 25s)</Text>
          </View>
        </LinearGradient>

        <View style={styles.cardBody}>
          {loading ? (
            <ActivityIndicator size="large" color={theme.colors.orange} style={styles.loader} />
          ) : loadError ? (
            <View style={styles.errorBlock}>
              <Text style={styles.empty}>Couldn’t load departures. Pull down to refresh.</Text>
            </View>
          ) : departures.length === 0 ? (
            <Text style={styles.empty}>No departures right now.</Text>
          ) : (
            <View style={styles.list}>
              {departures.map((d, i) => (
                <FadeInView key={i} delay={i * 60}>
                  <View style={styles.row}>
                    <View style={styles.routeBadge}>
                      <Text style={styles.route}>{d.route}</Text>
                    </View>
                    <Text style={styles.headsign}>{d.headsign || "—"}</Text>
                    <Text style={styles.mins}>{d.expected_mins} min</Text>
                  </View>
                </FadeInView>
              ))}
            </View>
          )}
        </View>
      </FadeInView>

      <FadeInView delay={140}>
        <PressableScale
          accessibilityLabel="I'll walk instead, go back to Home"
          accessibilityRole="button"
          onPress={onWalkInstead}
          style={styles.walkBtn}
        >
          <Text style={styles.walkBtnText}>I'll walk instead</Text>
        </PressableScale>
      </FadeInView>
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
  screen: { backgroundColor: theme.colors.surfaceAlt },
  container: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    marginBottom: 20,
    ...theme.shadows.md,
  },
  cardHeader: {
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
  },
  stopName: {
    ...theme.typography.screenTitle,
    color: theme.colors.textOnNavy,
  },
  accentUnderline: {
    width: 44,
    height: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.orange,
    marginTop: 8,
    marginBottom: 12,
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.orangeBright,
    marginRight: 8,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "DMSans_500Medium",
    color: theme.colors.textOnNavyMuted,
  },
  cardBody: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
  },
  loader: { marginVertical: 24 },
  empty: {
    fontSize: 15,
    fontFamily: "DMSans_400Regular",
    color: theme.colors.textSecondary,
    marginVertical: 16,
    textAlign: "center",
  },
  errorBlock: { marginVertical: 8 },
  list: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.lg,
    marginBottom: 8,
  },
  routeBadge: {
    minWidth: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.orangeSoft,
    alignItems: "center",
    marginRight: 12,
  },
  route: {
    fontSize: 16,
    fontFamily: "DMSans_700Bold",
    color: theme.colors.orange,
  },
  headsign: {
    flex: 1,
    fontSize: 15,
    fontFamily: "DMSans_400Regular",
    color: theme.colors.textSecondary,
  },
  mins: {
    fontSize: 16,
    fontFamily: "DMSans_600SemiBold",
    color: theme.colors.navy,
  },
  walkBtn: {
    padding: 16,
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.navy,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    ...theme.shadows.sm,
  },
  walkBtnText: {
    fontSize: 16,
    fontFamily: "DMSans_600SemiBold",
    color: theme.colors.navy,
  },
  error: {
    fontSize: 16,
    fontFamily: "DMSans_500Medium",
    color: theme.colors.error,
    marginBottom: 12,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.lg,
    ...theme.shadows.glowNavy,
  },
  btnText: {
    color: "#fff",
    fontFamily: "DMSans_600SemiBold",
  },
});
