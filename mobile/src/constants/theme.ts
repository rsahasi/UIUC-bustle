/**
 * App-wide theme for a more colorful, modern UI.
 */
export const theme = {
  colors: {
    primary: "#0D47A1",
    primaryDark: "#002171",
    secondary: "#FF6F00",
    accent: "#00BFA5",
    success: "#2E7D32",
    warning: "#F9A825",
    error: "#C62828",
    surface: "#FFFFFF",
    surfaceAlt: "#F5F9FF",
    card: "#E3F2FD",
    cardBorder: "#90CAF9",
    text: "#1A237E",
    textSecondary: "#546E7A",
    textMuted: "#78909C",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  typography: {
    title: { fontSize: 22, fontWeight: "700" as const },
    heading: { fontSize: 18, fontWeight: "600" as const },
    body: { fontSize: 16, fontWeight: "400" as const },
    caption: { fontSize: 14, fontWeight: "400" as const },
    label: { fontSize: 12, fontWeight: "600" as const },
  },
};
