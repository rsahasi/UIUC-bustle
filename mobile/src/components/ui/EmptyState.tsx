import { theme } from "@/src/constants/theme";
import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { FloatingView, Stagger } from "./motion";

interface EmptyStateProps {
  /** Optional lucide icon shown in a soft orange halo with a gentle float. */
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
}

/**
 * The nothing-here state.
 *
 * Icon, title, body and action arrive on the shared `Stagger` cadence rather
 * than all at once: an empty screen that fades in as a single block reads as a
 * loading failure, while a short cascade reads as an answer. `Stagger` skips
 * the entrance entirely under reduced motion, and drops absent children before
 * counting, so a state with no icon does not open on an empty beat.
 */
export function EmptyState({ icon: Icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <Stagger style={styles.container} itemStyle={styles.item}>
      {Icon ? (
        <FloatingView distance={6}>
          <View style={styles.iconHalo}>
            <Icon size={36} color={theme.colors.brandInk} strokeWidth={1.6} />
          </View>
        </FloatingView>
      ) : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {action ? (
        <View style={styles.actionWrap}>
          <Button label={action.label} onPress={action.onPress} variant="secondary" size="sm" />
        </View>
      ) : null}
    </Stagger>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: theme.spacing.xxl,
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  /** Applied to each staggered wrapper so its child stays centred. */
  item: {
    alignItems: "center",
  },
  iconHalo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.orangeSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...theme.text.heading,
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginTop: theme.spacing.sm,
  },
  subtitle: {
    ...theme.text.caption,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  actionWrap: {
    marginTop: theme.spacing.md,
  },
});
