// app/running-late.tsx
// Shows catchable buses with live countdowns when user is running late

import * as Location from 'expo-location';
import { useApiBaseUrl } from '@/src/hooks/useApiBaseUrl';
import { fetchNearbyStops, fetchDepartures } from '@/src/api/client';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/src/constants/theme';
import { Clock, MapPin, Navigation } from 'lucide-react-native';
import { formatDistance } from '@/src/utils/distance';

interface CatchableBus {
  stopId: string;
  stopName: string;
  stopLat: number;
  stopLng: number;
  distanceM: number;
  routeId: string;
  headsign: string;
  departsInMins: number;
  departsEpochMs: number;
  walkPaceNeeded: 'easy' | 'brisk' | 'run';
  onTimeForClass: boolean;
  lateByMins: number;
}

function formatCountdown(departsEpochMs: number, nowMs: number): string {
  const diffMs = departsEpochMs - nowMs;
  if (diffMs <= 0) return '0:00';
  const totalSecs = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function walkPaceLabel(pace: 'easy' | 'brisk' | 'run'): string {
  if (pace === 'easy') return 'Easy walk';
  if (pace === 'brisk') return 'Walk fast';
  return 'Run!';
}

function walkPaceColor(pace: 'easy' | 'brisk' | 'run'): string {
  if (pace === 'easy') return theme.colors.success;
  if (pace === 'brisk') return theme.colors.warning;
  return theme.colors.error;
}

export default function RunningLateScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const router = useRouter();

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [catchableBuses, setCatchableBuses] = useState<CatchableBus[]>([]);
  const [loading, setLoading] = useState(true);
  const [secondsNow, setSecondsNow] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live 1-second tick for countdown display
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setSecondsNow(Date.now());
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const fetchCatchableBuses = async (loc: { lat: number; lng: number }) => {
    try {
      const RADIUS_M = 640; // ~0.4 miles
      const MAX_DEPART_MINS = 8;

      const nearbyRes = await fetchNearbyStops(apiBaseUrl, loc.lat, loc.lng, RADIUS_M, { apiKey: apiKey ?? undefined });
      const stops = nearbyRes.stops ?? [];

      const busesNested = await Promise.all(
        stops.map(async (stop) => {
          // Distance from stop lat/lng stored in StopInfo — compute haversine
          const R = 6371000;
          const dLat = ((stop.lat - loc.lat) * Math.PI) / 180;
          const dLng = ((stop.lng - loc.lng) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((loc.lat * Math.PI) / 180) *
              Math.cos((stop.lat * Math.PI) / 180) *
              Math.sin(dLng / 2) *
              Math.sin(dLng / 2);
          const distanceM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

          try {
            const depRes = await fetchDepartures(apiBaseUrl, stop.stop_id, 15, { apiKey: apiKey ?? undefined });
            const deps = depRes.departures ?? [];
            return deps
              .filter((d) => d.expected_mins <= MAX_DEPART_MINS && d.expected_mins >= 0)
              .map((d) => {
                const departsEpochMs = Date.now() + d.expected_mins * 60 * 1000;
                const speedMps = d.expected_mins > 0
                  ? distanceM / (d.expected_mins * 60)
                  : 999;
                const walkPaceNeeded: 'easy' | 'brisk' | 'run' =
                  speedMps < 1.2 ? 'easy' : speedMps <= 2.0 ? 'brisk' : 'run';
                return {
                  stopId: stop.stop_id,
                  stopName: stop.stop_name,
                  stopLat: stop.lat,
                  stopLng: stop.lng,
                  distanceM,
                  routeId: d.route,
                  headsign: d.headsign,
                  departsInMins: d.expected_mins,
                  departsEpochMs,
                  walkPaceNeeded,
                  onTimeForClass: true,
                  lateByMins: 0,
                } as CatchableBus;
              });
          } catch {
            return [] as CatchableBus[];
          }
        })
      );

      const allBuses = busesNested.flat().sort((a, b) => a.departsInMins - b.departsInMins);
      setCatchableBuses(allBuses);
    } catch {
      setCatchableBuses([]);
    } finally {
      setLoading(false);
    }
  };

  // Get location + initial fetch
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLoading(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocation(loc);
        await fetchCatchableBuses(loc);

        // Poll every 20 seconds
        pollRef.current = setInterval(async () => {
          await fetchCatchableBuses(loc);
        }, 20_000);
      } catch {
        setLoading(false);
      }
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, apiKey]);

  const onNavigateToStop = (bus: CatchableBus) => {
    router.push({
      pathname: '/walk-nav',
      params: {
        dest_lat: String(bus.stopLat),
        dest_lng: String(bus.stopLng),
        dest_name: bus.stopName,
        route_id: bus.routeId,
      },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Running late?</Text>
        <Text style={styles.headerSubtitle}>Buses you can still catch</Text>
      </View>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.navy} />
          <Text style={styles.loadingText}>Finding nearby buses…</Text>
        </View>
      )}

      {!loading && catchableBuses.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            No catchable buses right now. Consider walking or calling a ride.
          </Text>
        </View>
      )}

      {!loading && catchableBuses.map((bus, i) => (
        <View key={`${bus.stopId}-${bus.routeId}-${i}`} style={styles.busCard}>
          {/* Top row: route badge + headsign + countdown */}
          <View style={styles.busCardTopRow}>
            <View style={styles.routeBadge}>
              <Text style={styles.routeBadgeText}>{bus.routeId}</Text>
            </View>
            <Text style={styles.headsign} numberOfLines={1}>{bus.headsign}</Text>
            <Text style={styles.countdown}>
              {formatCountdown(bus.departsEpochMs, secondsNow)}
            </Text>
          </View>

          {/* Stop name + distance */}
          <View style={styles.stopRow}>
            <MapPin size={13} color={theme.colors.textMuted} />
            <Text style={styles.stopName} numberOfLines={1}>
              {bus.stopName} · {formatDistance(bus.distanceM)} away
            </Text>
          </View>

          {/* Walk pace + countdown label */}
          <View style={styles.paceRow}>
            <View style={[styles.paceBadge, { backgroundColor: walkPaceColor(bus.walkPaceNeeded) }]}>
              <Text style={styles.paceBadgeText}>{walkPaceLabel(bus.walkPaceNeeded)}</Text>
            </View>
            <View style={styles.countdownLabelRow}>
              <Clock size={13} color={theme.colors.textMuted} />
              <Text style={styles.leavesInLabel}>Leaves in</Text>
            </View>
          </View>

          {/* Navigate button */}
          <Pressable
            style={styles.navigateBtn}
            onPress={() => onNavigateToStop(bus)}
            accessibilityLabel={`Navigate to ${bus.stopName}`}
            accessibilityRole="button"
          >
            <Navigation size={14} color="#fff" />
            <Text style={styles.navigateBtnText}>Navigate to stop</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surfaceAlt,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    backgroundColor: theme.colors.navy,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  headerTitle: {
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 22,
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 12,
  },
  loadingText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: theme.colors.textSecondary,
  },
  emptyContainer: {
    padding: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    marginHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  busCard: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.orange,
    padding: theme.spacing.md,
  },
  busCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  routeBadge: {
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 36,
    alignItems: 'center',
  },
  routeBadgeText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 12,
    color: '#fff',
  },
  headsign: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: theme.colors.navy,
    flex: 1,
  },
  countdown: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 24,
    color: theme.colors.orange,
    letterSpacing: -0.5,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  stopName: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: theme.colors.textMuted,
    flex: 1,
  },
  paceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  paceBadge: {
    borderRadius: theme.radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  paceBadgeText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
    color: '#fff',
  },
  countdownLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  leavesInLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  navigateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.sm,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  navigateBtnText: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    color: '#fff',
  },
});
