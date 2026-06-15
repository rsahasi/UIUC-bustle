/**
 * UIUC Bustle — Design system v2: UIUC brand colors amped up with gradients,
 * glow shadows, vibrant supporting accents, and motion-friendly tokens.
 * DM Sans/Serif fonts, tight spacing.
 */
export const theme = {
  colors: {
    orange: "#E84A27",       // CTAs, active tab, Live badges, route accents
    orangeBright: "#FF6B3D", // gradient partner / pressed states / glows
    orangeSoft: "#FFF0EA",   // tinted backgrounds behind orange content
    navy: "#13294B",         // headers, text, tab bar background
    navyLight: "#1D3D6F",    // secondary backgrounds
    navyDeep: "#0B1B36",     // hero gradient base, tab bar
    surface: "#FFFFFF",
    surfaceAlt: "#F4F5F7",   // screen background, input fill
    surfaceRaised: "#FBFBFD",// subtle raised panels inside cards
    border: "#DDE1E7",       // 1px dividers
    borderSoft: "#EAEDF2",   // even quieter dividers
    text: "#0F1923",
    textSecondary: "#4B5563",
    textMuted: "#9CA3AF",
    textOnNavy: "rgba(255,255,255,0.92)",
    textOnNavyMuted: "rgba(255,255,255,0.6)",
    success: "#16A34A",
    successSoft: "#E8F8EE",
    warning: "#D97706",
    warningSoft: "#FEF4E6",
    error: "#DC2626",
    errorSoft: "#FDEDED",
    // Vibrant supporting accents — sparks of color for charts, rings, chips
    sky: "#38BDF8",
    gold: "#FBBF24",
    mint: "#34D399",
    violet: "#8B5CF6",
    // Legacy aliases (used by existing code)
    primary: "#13294B",
    primaryDark: "#0D1E35",
    secondary: "#E84A27",
    accent: "#E84A27",
    card: "#F4F5F7",
    cardBorder: "#DDE1E7",
    background: "#F4F5F7",
  },
  /** Gradient color stops — use with expo-linear-gradient. */
  gradients: {
    hero: ["#0B1B36", "#13294B", "#1D3D6F"] as const,        // deep navy hero headers
    sunset: ["#FF6B3D", "#E84A27"] as const,                 // primary CTA / FAB
    sunrise: ["#FF8A5C", "#E84A27", "#C73B1D"] as const,     // big hero CTAs
    ember: ["#1D3D6F", "#13294B"] as const,                  // dark cards
    glowCard: ["#FFFFFF", "#FFF7F4"] as const,               // warm-tinted highlight card
    skyline: ["#38BDF8", "#8B5CF6"] as const,                // activity / fun accents
    mintFresh: ["#34D399", "#38BDF8"] as const,              // success / streak accents
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
    xl: 18,
    xxl: 26,
    pill: 999,
  },
  /** Elevation presets — spread into style objects. */
  shadows: {
    sm: {
      shadowColor: "#13294B",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 1,
    },
    md: {
      shadowColor: "#13294B",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 10,
      elevation: 3,
    },
    lg: {
      shadowColor: "#0B1B36",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.14,
      shadowRadius: 20,
      elevation: 6,
    },
    glowOrange: {
      shadowColor: "#E84A27",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 5,
    },
    glowNavy: {
      shadowColor: "#13294B",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 14,
      elevation: 5,
    },
  },
  /** Motion durations/spring configs shared across animated components. */
  motion: {
    fast: 160,
    base: 280,
    slow: 450,
    spring: { damping: 16, stiffness: 220, mass: 0.7 },
    springBouncy: { damping: 12, stiffness: 180, mass: 0.8 },
  },
  typography: {
    heroTitle:    { fontFamily: "DMSerifDisplay_400Regular", fontSize: 34, lineHeight: 40 },
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
