import { fetchDepartures } from "@/src/api/client";
import type { DepartureItem } from "@/src/api/types";
import { Badge } from "@/src/components/ui/Badge";
import { DepartureRow } from "@/src/components/ui/DepartureRow";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { FadeInView, PressableScale, Skeleton } from "@/src/components/ui/motion";
import { theme } from "@/src/constants/theme";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Bus, CloudOff, Footprints } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const REFRESH_INTERVAL_MS = 25000;

/** Render-only placeholder row while the departure board loads. */
function DepartureRowSkeleton({ delay }: { delay: number }) {
  return (
    <FadeInView delay={delay} dy={8} style={styles.skeletonRow}>
      <Skeleton width={44} height={20} radius={theme.radius.pill} />
      <View style={styles.skeletonMiddle}>
        <Skeleton width="72%" height={14} />
      </View>
      <Skeleton width={48} height={16} />
    </FadeInView>
  );
}

export default function TripScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { stop_id, stop_name } = useLocalSearchParams<{ stop_id: string; stop_name?: string }>();
  const router = useRouter();
  const [departures, setDepartures] = useState<DepartureItem[]>([]);
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
        <EmptyState
          icon={Bus}
          title="Missing stop"
          subtitle="This departure board was opened without a stop."
          action={{ label: "Go back", onPress: () => router.back() }}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={theme.colors.navy}
          colors={[theme.colors.brandInk]}
          progressBackgroundColor={theme.colors.surface}
        />
      }
    >
      <FadeInView delay={0} style={styles.board}>
        <LinearGradient
          colors={[theme.gradients.hero[0], theme.gradients.hero[1], theme.gradients.hero[2]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.boardHeader}
        >
          <Text style={styles.eyebrow}>Departure board</Text>
          <Text style={styles.stopName} accessibilityRole="header">
            {stop_name || stop_id}
          </Text>
          <View style={styles.accentUnderline} />
          <View style={styles.liveRow}>
            <Badge label="LIVE" variant="live" size="sm" />
            <Text style={styles.subtitle}>Updates every 25 seconds</Text>
          </View>
        </LinearGradient>

        <View style={styles.boardBody}>
          {loading ? (
            <View accessibilityLabel="Loading departures">
              {[0, 1, 2, 3, 4].map((i) => (
                <DepartureRowSkeleton key={i} delay={i * 70} />
              ))}
            </View>
          ) : loadError ? (
            <EmptyState
              icon={CloudOff}
              title="Couldn't load departures"
              subtitle="Check your connection, then pull down or tap to retry."
              action={{ label: "Try again", onPress: load }}
            />
          ) : departures.length === 0 ? (
            <EmptyState
              icon={Bus}
              title="No departures right now"
              subtitle="Nothing is scheduled from this stop in the next hour."
            />
          ) : (
            <View>
              <SectionHeader title="Next departures" />
              {departures.map((d, i) => (
                <FadeInView key={i} delay={i * 55} dy={10}>
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
          <Footprints size={18} color={theme.colors.navy} strokeWidth={2.2} />
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
    padding: theme.layout.gutter,
    backgroundColor: theme.colors.surfaceAlt,
  },
  screen: { backgroundColor: theme.colors.surfaceAlt },
  container: {
    padding: theme.layout.gutter,
    paddingBottom: theme.layout.sectionGap + 4,
  },
  board: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    marginBottom: theme.layout.sectionGap - 8,
    overflow: "hidden",
    ...theme.elevation[2],
  },
  boardHeader: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg + 2,
    paddingBottom: theme.spacing.lg - 2,
  },
  eyebrow: {
    ...theme.text.eyebrow,
    color: theme.colors.textOnNavyMuted,
    marginBottom: theme.spacing.sm,
  },
  stopName: {
    ...theme.text.title1,
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
    gap: theme.spacing.sm,
  },
  subtitle: {
    ...theme.text.caption,
    color: theme.colors.textOnNavyMuted,
  },
  boardBody: {
    paddingBottom: theme.spacing.sm,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: theme.layout.tapMin,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSoft,
  },
  skeletonMiddle: { flex: 1 },
  walkBtn: {
    minHeight: theme.layout.tapMin,
    flexDirection: "row",
    gap: theme.spacing.sm,
    padding: theme.spacing.md + 2,
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.navy,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...theme.elevation[1],
  },
  walkBtnText: {
    ...theme.text.subhead,
    fontSize: 16,
    color: theme.colors.navy,
  },
});
