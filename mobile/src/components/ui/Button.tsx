import { theme } from "@/src/constants/theme";
import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
}

export function Button({ label, onPress, variant = "primary", size = "md", icon: Icon, loading, disabled }: ButtonProps) {
  const isDisabled = disabled || loading;
  const s = styles[variant];
  const padV = size === "sm" ? 6 : 10;
  const padH = size === "sm" ? 12 : 16;
  const fontSize = size === "sm" ? 13 : 15;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        s.container,
        { paddingVertical: padV, paddingHorizontal: padH, opacity: isDisabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "primary" ? "#fff" : theme.colors.orange} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {Icon && <Icon size={size === "sm" ? 14 : 16} color={s.label.color} strokeWidth={2} />}
          <Text style={[s.label, { fontSize, fontFamily: "DMSans_600SemiBold" }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = {
  primary: StyleSheet.create({
    container: { backgroundColor: theme.colors.orange, borderRadius: theme.radius.md, alignItems: "center" as const },
    label: { color: "#fff" },
  }),
  secondary: StyleSheet.create({
    container: { borderWidth: 1.5, borderColor: theme.colors.navy, borderRadius: theme.radius.md, alignItems: "center" as const },
    label: { color: theme.colors.navy },
  }),
  ghost: StyleSheet.create({
    container: { borderRadius: theme.radius.md, alignItems: "center" as const },
    label: { color: theme.colors.orange },
  }),
};
