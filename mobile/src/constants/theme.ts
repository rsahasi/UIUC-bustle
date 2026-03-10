/**
 * UIUC Bustle — Design system: UIUC brand colors, DM Sans/Serif fonts, tight spacing.
 */
export const theme = {
  colors: {
    orange: "#E84A27",       // CTAs, active tab, Live badges, route accents
    navy: "#13294B",         // headers, text, tab bar background
    navyLight: "#1D3D6F",    // secondary backgrounds
    surface: "#FFFFFF",
    surfaceAlt: "#F4F5F7",   // screen background, input fill
    border: "#DDE1E7",       // 1px dividers
    text: "#0F1923",
    textSecondary: "#4B5563",
    textMuted: "#9CA3AF",
    success: "#16A34A",
    warning: "#D97706",
    error: "#DC2626",
    // Legacy aliases (used by existing code)
    primary: "#13294B",
    primaryDark: "#0D1E35",
    secondary: "#E84A27",
    accent: "#E84A27",
    card: "#F4F5F7",
    cardBorder: "#DDE1E7",
  },
  spacing: {
    xs: 3,
    sm: 6,
    md: 12,
    lg: 20,
    xl: 28,
    xxl: 40,
  },
  radius: {
    xs: 3,
    sm: 5,
    md: 8,
    lg: 12,
  },
  typography: {
    displayTitle: { fontFamily: "DMSerifDisplay_400Regular", fontSize: 28, lineHeight: 34 },
    screenTitle:  { fontFamily: "DMSerifDisplay_400Regular", fontSize: 22, lineHeight: 28 },
    heading:      { fontFamily: "DMSans_600SemiBold", fontSize: 17, lineHeight: 24 },
    subheading:   { fontFamily: "DMSans_600SemiBold", fontSize: 15, lineHeight: 20 },
    body:         { fontFamily: "DMSans_400Regular", fontSize: 15, lineHeight: 22 },
    caption:      { fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 18 },
    label:        { fontFamily: "DMSans_500Medium", fontSize: 12, lineHeight: 16 },
    // Legacy aliases (used by existing screens before redesign)
    title: { fontFamily: "DMSerifDisplay_400Regular", fontSize: 22, lineHeight: 28 },
  },
};
