import { theme } from "@/src/constants/theme";
import type { CrowdingLevel } from "@/src/api/types";
import { useSubmitCrowding } from "@/src/queries/crowding";
import { CROWDING_ICONS } from "@/src/utils/crowding";
import { Button } from "@/src/components/ui/Button";
import { CelebrationBurst, PressableScale } from "@/src/components/ui/motion";
import { useState, useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
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
  const [selected, setSelected] = useState<CrowdingLevel | null>(null);

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

  // Visual-only: clear the highlighted option each time the sheet reopens.
  useEffect(() => {
    if (visible) setSelected(null);
  }, [visible]);

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
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss crowding sheet"
      />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          How full is this bus?
        </Text>
        <Text style={styles.subtitle}>Route {routeId} · your report helps other riders</Text>

        {submitted ? (
          <View style={styles.thankYou}>
            <CelebrationBurst count={14} radius={72} style={StyleSheet.absoluteFill} />
            <View style={styles.thankYouGlyph}>
              <Text style={styles.thankYouCheck}>✓</Text>
            </View>
            <Text style={styles.thankYouText}>Thanks for reporting!</Text>
            {cooldownSecs > 0 && (
              <Text style={styles.cooldownText}>
                You can report again in {fmtCooldown(cooldownSecs)}
              </Text>
            )}
          </View>
        ) : (
          <>
            {OPTIONS.map((opt) => {
              const isSelected = selected === opt.level;
              return (
                <PressableScale
                  key={opt.level}
                  scaleTo={0.98}
                  onPress={() => setSelected(opt.level)}
                  disabled={isPending}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected, selected: isSelected, disabled: isPending }}
                  accessibilityLabel={`${opt.label}. ${opt.sub}`}
                  style={[styles.option, isSelected && styles.optionSelected]}
                >
                  <View style={[styles.glyphHalo, { borderColor: theme.colors.crowd[opt.level] }]}>
                    <Text style={styles.glyph}>{CROWDING_ICONS[opt.level]}</Text>
                  </View>
                  <View style={styles.optionText}>
                    <Text style={styles.optionLabel}>{opt.label}</Text>
                    <Text style={styles.optionSub}>{opt.sub}</Text>
                  </View>
                  <View style={[styles.radio, isSelected && styles.radioSelected]}>
                    {isSelected && <Text style={styles.radioCheck}>✓</Text>}
                  </View>
                </PressableScale>
              );
            })}
            {error && (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {error}
              </Text>
            )}
            <View style={styles.submitWrap}>
              <Button
                label={selected ? "Submit report" : "Select a level to report"}
                onPress={() => {
                  if (selected) handleSelect(selected);
                }}
                variant="primary"
                loading={isPending}
                disabled={!selected}
              />
            </View>
          </>
        )}

        <PressableScale
          onPress={onClose}
          haptic={false}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.closeBtnText}>Close</Text>
        </PressableScale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xxl,
    borderTopRightRadius: theme.radius.xxl,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    ...theme.elevation[3],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.border,
    alignSelf: "center",
    marginBottom: theme.spacing.md,
  },
  title: {
    ...theme.text.title2,
    color: theme.colors.text,
    marginBottom: 2,
  },
  subtitle: {
    ...theme.text.caption,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: theme.layout.tapMin + 12,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.borderSoft,
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.sm,
  },
  optionSelected: {
    borderColor: theme.colors.navy,
    backgroundColor: theme.colors.surfaceRaised,
    ...theme.elevation[1],
  },
  glyphHalo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    backgroundColor: theme.colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: { fontSize: 14 },
  optionText: { flex: 1 },
  optionLabel: {
    ...theme.text.subhead,
    color: theme.colors.text,
  },
  optionSub: {
    ...theme.text.caption,
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    borderColor: theme.colors.navy,
    backgroundColor: theme.colors.navy,
  },
  radioCheck: {
    color: theme.colors.textOnNavy,
    fontSize: 12,
    lineHeight: 14,
    fontFamily: "DMSans_700Bold",
  },
  error: {
    ...theme.text.caption,
    color: theme.colors.errorDeep,
    marginTop: theme.spacing.sm,
  },
  submitWrap: { marginTop: theme.spacing.md },
  thankYou: { paddingVertical: theme.spacing.lg, alignItems: "center", gap: theme.spacing.sm },
  thankYouGlyph: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.successSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  thankYouCheck: {
    fontSize: 26,
    lineHeight: 32,
    color: theme.colors.successDeep,
    fontFamily: "DMSans_700Bold",
  },
  thankYouText: {
    ...theme.text.heading,
    color: theme.colors.text,
  },
  cooldownText: {
    ...theme.text.caption,
    color: theme.colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  closeBtn: {
    marginTop: theme.spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: theme.layout.tapMin,
  },
  closeBtnText: {
    ...theme.text.subhead,
    fontSize: 14,
    color: theme.colors.textMuted,
  },
});
