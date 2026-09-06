import { theme } from "@/src/constants/theme";
import { fireHaptic, Press } from "@/src/components/ui/motion";
import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md";
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Screen-reader label when the visible label lacks context (e.g. "Navigate to Wright & Green"). */
  accessibilityLabel?: string;
}

type ButtonVariant = NonNullable<ButtonProps["variant"]>;

const SPINNER_COLOR: Record<ButtonVariant, string> = {
  primary: "#FFFFFF",
  destructive: "#FFFFFF",
  secondary: theme.colors.navy,
  ghost: theme.colors.brandInk,
};

/**
 * Press wash per variant.
 *
 * Both stops are written out in full: the `tint` variant crossfades between
 * them, and a `from` that is merely "transparent" would be transparent BLACK,
 * so a coloured wash would fade in through grey. Each `from` here is its own
 * `to` at zero alpha.
 *
 * The wash sits INSIDE the filled surface, i.e. over the gradient, which is
 * why a press reads on the primary button at all — a background tint behind
 * an opaque gradient would be invisible.
 */
const PRESS_TINT: Record<ButtonVariant, { from: string; to: string }> = {
  // navyDeep #0B1B36 — darkens the orange gradient without greying it.
  primary: { from: "rgba(11,27,54,0)", to: "rgba(11,27,54,0.22)" },
  destructive: { from: "rgba(11,27,54,0)", to: "rgba(11,27,54,0.22)" },
  // navy #13294B at a whisper — the outlined button's own ink.
  secondary: { from: "rgba(19,41,75,0)", to: "rgba(19,41,75,0.10)" },
  // brandInk #B03114 — ghost has no surface of its own to darken.
  ghost: { from: "rgba(176,49,20,0)", to: "rgba(176,49,20,0.10)" },
};

/**
 * The app's button.
 *
 * Press state is `Press variant="tint"`: a wash rather than a scale, because
 * these sit in rows and sheets where a shrinking control drags the eye off the
 * label it is trying to read. `Press` also enforces the 44pt floor and a
 * declared accessibility role at compile time.
 *
 * Haptics come from the token map, never from a raw expo-haptics style:
 * `HAPTIC.tap` on touch (via `Press`), and `HAPTIC.commit` the moment a
 * loading button resolves — the confirmation belongs to the work finishing,
 * not to the finger.
 */
export function Button({ label, onPress, variant = "primary", size = "md", icon: Icon, loading, disabled, accessibilityLabel }: ButtonProps) {
  const isDisabled = disabled || loading;
  const s = styles[variant];
  const padV = size === "sm" ? 7 : 12;
  const padH = size === "sm" ? 14 : 18;
  const fontSize = size === "sm" ? 13 : 15;
  const isFilled = variant === "primary" || variant === "destructive";

  // Deliberately no automatic "commit" haptic when the spinner clears. A
  // resolved request is not a SUCCESSFUL one, and HAPTIC.commit is a medium
  // tick that reads as "it worked" — firing it after a save that errored is a
  // lie the user feels. Only the call site knows the outcome, so it fires
  // fireHaptic("commit") on success (and HAPTIC.warn on failure) itself.

  const content = loading ? (
    <ActivityIndicator size="small" color={SPINNER_COLOR[variant]} />
  ) : (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} color={s.label.color} strokeWidth={2.2} />}
      <Text style={[s.label, { fontSize, fontFamily: "DMSans_600SemiBold" }]}>{label}</Text>
    </View>
  );

  const tint = PRESS_TINT[variant];

  const surface = (
    <Press
      variant="tint"
      haptic="tap"
      tintFrom={tint.from}
      tintTo={tint.to}
      onPress={onPress}
      disabled={isDisabled}
      style={[baseStyles.fill, { paddingVertical: padV, paddingHorizontal: padH }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
    >
      {content}
    </Press>
  );

  const shell = [
    baseStyles.container,
    s.container,
    variant === "primary" && !isDisabled && theme.shadows.glowOrange,
    { opacity: isDisabled ? 0.5 : 1 },
  ];

  if (variant === "primary") {
    return (
      <LinearGradient
        // Ends on ctaEnd so the white label holds AA contrast on the darker stop.
        colors={[theme.colors.orangeBright, theme.colors.ctaEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={shell}
      >
        {surface}
      </LinearGradient>
    );
  }

  return (
    <View style={[...shell, isFilled && { backgroundColor: theme.colors.errorDeep }]}>
      {surface}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  container: {
    minHeight: theme.layout.tapMin,
    minWidth: theme.layout.tapMin,
    justifyContent: "center",
  },
  fill: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

// No `alignItems` on any shell: the Press must stretch to the whole shell so
// the tap target and the press wash both cover the full button. The label is
// centred by `baseStyles.fill` inside it.
const styles = {
  primary: StyleSheet.create({
    container: { borderRadius: theme.radius.lg, overflow: "hidden" as const },
    label: { color: "#fff" },
  }),
  destructive: StyleSheet.create({
    container: { borderRadius: theme.radius.lg, overflow: "hidden" as const },
    label: { color: "#fff" },
  }),
  secondary: StyleSheet.create({
    // overflow:hidden so the press wash is clipped to the rounded border
    // instead of squaring off the corners.
    container: { borderWidth: 1.5, borderColor: theme.colors.navy, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, overflow: "hidden" as const },
    label: { color: theme.colors.navy },
  }),
  ghost: StyleSheet.create({
    container: { borderRadius: theme.radius.lg, overflow: "hidden" as const },
    label: { color: theme.colors.brandInk },
  }),
};
