import { theme } from "@/src/constants/theme";
import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { FadeInView, FloatingView } from "./motion";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ icon: Icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <FadeInView style={styles.container}>
      <FloatingView distance={6}>
        <View style={styles.iconHalo}>
          <Icon size={36} color={theme.colors.orange} strokeWidth={1.6} />
        </View>
      </FloatingView>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {action && (
        <View style={{ marginTop: theme.spacing.md }}>
          <Button label={action.label} onPress={action.onPress} variant="secondary" size="sm" />
        </View>
      )}
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: theme.spacing.xxl,
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
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
    fontFamily: "DMSans_600SemiBold",
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginTop: theme.spacing.sm,
  },
  subtitle: {
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
});
