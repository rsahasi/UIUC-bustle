import { theme } from "@/src/constants/theme";
import type { CrowdingLevel } from "@/src/api/types";
import { useSubmitCrowding } from "@/src/queries/crowding";
import { CROWDING_COLORS, CROWDING_ICONS } from "@/src/utils/crowding";
import { useState, useEffect } from "react";
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const COOLDOWN_KEY_PREFIX = "crowding_cooldown_";
const COOLDOWN_MS = 10 * 60 * 1000;

const OPTIONS: { level: CrowdingLevel; label: string; sub: string }[] = [
  { level: 1, label: "Plenty of seats", sub: "Easy to find a spot" },
  { level: 2, label: "Some seats available", sub: "A few open seats" },
  { level: 3, label: "Standing room only", sub: "Bus is packed" },
  { level: 4, label: "Full — no space", sub: "Cannot board" },
];

interface CrowdingSheetProps {
  visible: boolean;
  vehicleId: string;
  routeId: string;
  tripId?: string;
  onClose: () => void;
}

export function CrowdingSheet({ visible, vehicleId, routeId, tripId, onClose }: CrowdingSheetProps) {
  const { mutateAsync, isPending } = useSubmitCrowding();
  const [submitted, setSubmitted] = useState(false);
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const cooldownKey = `${COOLDOWN_KEY_PREFIX}${vehicleId}`;

  useEffect(() => {
    if (!visible) return;
    setSubmitted(false);
    setError(null);
    AsyncStorage.getItem(cooldownKey).then((val) => {
      if (!val) return;
      const remaining = Math.round((parseInt(val, 10) - Date.now()) / 1000);
      if (remaining > 0) {
        setSubmitted(true);
        setCooldownSecs(remaining);
      }
    });
  }, [visible, cooldownKey]);

  useEffect(() => {
    if (cooldownSecs <= 0) return;
    const t = setInterval(() => setCooldownSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownSecs]);

  async function handleSelect(level: CrowdingLevel) {
    setError(null);
    try {
      await mutateAsync({ vehicle_id: vehicleId, route_id: routeId, trip_id: tripId, crowding_level: level });
      const expiry = Date.now() + COOLDOWN_MS;
      await AsyncStorage.setItem(cooldownKey, String(expiry));
      setCooldownSecs(Math.round(COOLDOWN_MS / 1000));
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message ?? "Failed to submit. Try again.");
    }
  }

  const fmtCooldown = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>How full is this bus?</Text>
        <Text style={styles.subtitle}>Route {routeId}</Text>

        {submitted ? (
          <View style={styles.thankYou}>
            <Text style={styles.thankYouText}>Thanks for reporting!</Text>
            {cooldownSecs > 0 && (
              <Text style={styles.cooldownText}>
                You can report again in {fmtCooldown(cooldownSecs)}
              </Text>
            )}
          </View>
        ) : (
          <>
            {OPTIONS.map((opt) => (
              <Pressable
                key={opt.level}
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                onPress={() => handleSelect(opt.level)}
                disabled={isPending}
              >
                <View style={[styles.dot, { backgroundColor: CROWDING_COLORS[opt.level] }]} />
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>
                    {CROWDING_ICONS[opt.level]} {opt.label}
                  </Text>
                  <Text style={styles.optionSub}>{opt.sub}</Text>
                </View>
                {isPending && <ActivityIndicator size="small" color={theme.colors.navy} />}
              </Pressable>
            ))}
            {error && <Text style={styles.error}>{error}</Text>}
          </>
        )}

        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: theme.spacing.lg,
    paddingBottom: 32,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.colors.border,
    alignSelf: "center", marginBottom: theme.spacing.md,
  },
  title: {
    fontFamily: "DMSerif_400Regular",
    fontSize: 20, color: theme.colors.text,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13, color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  option: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  optionPressed: { backgroundColor: theme.colors.background },
  dot: { width: 12, height: 12, borderRadius: 6 },
  optionText: { flex: 1 },
  optionLabel: {
    fontFamily: "DMSans_500Medium", fontSize: 15, color: theme.colors.text,
  },
  optionSub: {
    fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.colors.textSecondary,
  },
  thankYou: { paddingVertical: theme.spacing.lg, alignItems: "center" },
  thankYouText: {
    fontFamily: "DMSans_600SemiBold", fontSize: 16, color: theme.colors.text,
  },
  cooldownText: {
    fontFamily: "DMSans_400Regular", fontSize: 13,
    color: theme.colors.textSecondary, marginTop: theme.spacing.sm,
  },
  error: {
    fontFamily: "DMSans_400Regular", fontSize: 13,
    color: "#F44336", marginTop: theme.spacing.sm,
  },
  closeBtn: {
    marginTop: theme.spacing.md, alignItems: "center",
    paddingVertical: theme.spacing.sm,
  },
  closeBtnText: {
    fontFamily: "DMSans_500Medium", fontSize: 14, color: theme.colors.textSecondary,
  },
});
