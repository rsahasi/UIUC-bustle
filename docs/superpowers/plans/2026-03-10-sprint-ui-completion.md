# Sprint: UI Completion & UX Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the established UIUC design system (navy/orange, DM Serif/Sans, sharp radius, elevation cards) to the 5 remaining screens — map, schedule, activity, settings, walk-nav — and add 3 high-value UX improvements.

**Architecture:** Each screen is self-contained with inline StyleSheet. Apply the design tokens from `mobile/src/constants/theme.ts` consistently. No new shared components needed — use the existing `mobile/src/components/ui/` primitives where they fit. Each task is one screen or one UX feature, independently deployable.

**Tech Stack:** React Native, Expo Router, lucide-react-native, DM Sans / DM Serif Display fonts, theme constants at `mobile/src/constants/theme.ts`

---

## Design System Reference

Before implementing any screen, internalize these rules:
- **Background:** `surfaceAlt` (`#F4F5F7`) for scroll containers, `surface` (`#fff`) for cards
- **Cards:** `borderRadius: 14`, shadow `opacity: 0.07–0.08 / radius: 8–10`, no shadow > 12
- **Radius cap:** max `theme.radius.md` (8) for pills/badges; 14 for cards; 20 for CTAs
- **Section titles:** `DMSerifDisplay_400Regular` 20px, navy
- **Body text:** `DMSans_400Regular` 15px, `#0F1923`
- **Muted text:** `DMSans_400Regular` 13px, `#9CA3AF`
- **CTA buttons:** orange fill, `borderRadius: 20`, `DMSans_700Bold` 14px white
- **Left accent borders:** `borderLeftWidth: 4–5`, orange or status color
- **Nav headers:** navy background, DM Serif Display title, no shadow

---

## Chunk 1: Map Screen

### Task 1: map.tsx — Search Bar & Suggestions Overlay

**Files:**
- Modify: `mobile/app/(tabs)/map.tsx` (styles: `searchBarWrapper`, `searchInput`, `suggestionsList`, `suggestionItem`)

- [ ] **Step 1: Update search bar wrapper style**

Find `searchBarWrapper` (or equivalent) in the StyleSheet. Replace with:
```typescript
searchBarWrapper: {
  position: "absolute",
  top: 16,
  left: 16,
  right: 16,
  zIndex: 10,
  backgroundColor: theme.colors.surface,
  borderRadius: 14,
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: 14,
  height: 50,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 10,
  elevation: 4,
  borderWidth: 1,
  borderColor: theme.colors.border,
},
```

- [ ] **Step 2: Update suggestions dropdown style**

```typescript
suggestionsList: {
  position: "absolute",
  top: 66,
  left: 16,
  right: 16,
  zIndex: 10,
  backgroundColor: theme.colors.surface,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: theme.colors.border,
  overflow: "hidden",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.1,
  shadowRadius: 12,
  elevation: 5,
},
suggestionItem: {
  paddingVertical: 11,
  paddingHorizontal: 16,
  borderBottomWidth: 1,
  borderBottomColor: theme.colors.border,
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
},
suggestionText: {
  fontFamily: "DMSans_400Regular",
  fontSize: 14,
  color: theme.colors.text,
  flex: 1,
},
suggestionSub: {
  fontFamily: "DMSans_400Regular",
  fontSize: 12,
  color: theme.colors.textMuted,
  marginTop: 1,
},
```

- [ ] **Step 3: Verify map loads and search bar floats correctly on simulator**
- [ ] **Step 4: Commit**
```bash
git add mobile/app/\(tabs\)/map.tsx
git commit -m "design: map search bar overlay — elevated card, sharp radius"
```

---

### Task 2: map.tsx — Stop Markers & Bottom Sheet

**Files:**
- Modify: `mobile/app/(tabs)/map.tsx` (styles: `bottomSheet`, `stopSheetTitle`, `depRow`, `getRoutesBtn`)

- [ ] **Step 1: Update bottom sheet container**

Find the bottom sheet / stop info panel styles and replace:
```typescript
bottomSheet: {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  backgroundColor: theme.colors.surface,
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  paddingHorizontal: 20,
  paddingTop: 14,
  paddingBottom: 32,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.1,
  shadowRadius: 12,
  elevation: 8,
},
stopSheetHandle: {
  width: 36,
  height: 4,
  backgroundColor: theme.colors.border,
  borderRadius: 2,
  alignSelf: "center",
  marginBottom: 12,
},
stopSheetTitle: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 18,
  color: theme.colors.navy,
  marginBottom: 2,
},
stopSheetDistance: {
  fontFamily: "DMSans_400Regular",
  fontSize: 13,
  color: theme.colors.textMuted,
  marginBottom: 12,
},
```

- [ ] **Step 2: Add drag handle element to bottom sheet JSX**

At the top of the bottom sheet View, add:
```tsx
<View style={styles.stopSheetHandle} />
```

- [ ] **Step 3: Update departure rows in bottom sheet**
```typescript
depRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  paddingVertical: 10,
  borderBottomWidth: 1,
  borderBottomColor: theme.colors.border,
},
depRouteBadge: {
  backgroundColor: theme.colors.navy,
  borderRadius: 6,
  paddingHorizontal: 9,
  paddingVertical: 4,
  minWidth: 38,
  alignItems: "center",
},
depRouteBadgeText: {
  fontFamily: "DMSans_700Bold",
  fontSize: 12,
  color: "#fff",
},
depHeadsign: {
  fontFamily: "DMSans_400Regular",
  fontSize: 14,
  color: theme.colors.text,
  flex: 1,
},
depCountdown: {
  fontFamily: "DMSans_700Bold",
  fontSize: 15,
  color: theme.colors.navy,
},
```

- [ ] **Step 4: Update "Get Routes" CTA button**
```typescript
getRoutesBtn: {
  backgroundColor: theme.colors.orange,
  borderRadius: 20,
  paddingVertical: 13,
  alignItems: "center",
  marginTop: 14,
},
getRoutesBtnText: {
  fontFamily: "DMSans_700Bold",
  fontSize: 15,
  color: "#fff",
},
```

- [ ] **Step 5: Verify bottom sheet appears correctly when a stop is tapped**
- [ ] **Step 6: Commit**
```bash
git add mobile/app/\(tabs\)/map.tsx
git commit -m "design: map bottom sheet — rounded drawer, navy headers, orange CTA"
```

---

## Chunk 2: Schedule Screen

### Task 3: schedule.tsx — Header & Day Selector

**Files:**
- Modify: `mobile/app/(tabs)/schedule.tsx`

- [ ] **Step 1: Update scroll container background**
```typescript
container: {
  flex: 1,
  backgroundColor: theme.colors.surfaceAlt,
},
```

- [ ] **Step 2: Replace day selector pills**

Find the day picker row styles and replace:
```typescript
daysRow: {
  flexDirection: "row",
  gap: 6,
  paddingHorizontal: theme.spacing.lg,
  paddingVertical: 12,
  backgroundColor: theme.colors.surface,
  borderBottomWidth: 1,
  borderBottomColor: theme.colors.border,
},
dayPill: {
  flex: 1,
  paddingVertical: 7,
  borderRadius: 8,
  alignItems: "center",
  backgroundColor: theme.colors.surfaceAlt,
  borderWidth: 1,
  borderColor: theme.colors.border,
},
dayPillActive: {
  backgroundColor: theme.colors.navy,
  borderColor: theme.colors.navy,
},
dayPillText: {
  fontFamily: "DMSans_600SemiBold",
  fontSize: 11,
  color: theme.colors.textMuted,
},
dayPillTextActive: {
  color: "#fff",
},
```

- [ ] **Step 3: Update section header for class list**
```typescript
sectionHeader: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 20,
  color: theme.colors.navy,
  paddingHorizontal: theme.spacing.lg,
  paddingTop: 20,
  paddingBottom: 8,
},
```

- [ ] **Step 4: Commit**
```bash
git add mobile/app/\(tabs\)/schedule.tsx
git commit -m "design: schedule header, day selector pills — navy active state"
```

---

### Task 4: schedule.tsx — Class Cards & Add Form

**Files:**
- Modify: `mobile/app/(tabs)/schedule.tsx`

- [ ] **Step 1: Redesign class card**
```typescript
classCard: {
  backgroundColor: theme.colors.surface,
  borderRadius: 14,
  marginHorizontal: 16,
  marginBottom: 10,
  padding: 16,
  borderLeftWidth: 4,
  borderLeftColor: theme.colors.orange,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
},
classCardTitle: {
  fontFamily: "DMSans_700Bold",
  fontSize: 16,
  color: theme.colors.navy,
  marginBottom: 4,
},
classCardMeta: {
  fontFamily: "DMSans_400Regular",
  fontSize: 13,
  color: theme.colors.textSecondary,
  marginBottom: 2,
},
classCardLeaveBy: {
  fontFamily: "DMSans_600SemiBold",
  fontSize: 13,
  marginTop: 6,
},
classCardActions: {
  flexDirection: "row",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 10,
  paddingTop: 10,
  borderTopWidth: 1,
  borderTopColor: theme.colors.border,
},
```

- [ ] **Step 2: Style delete and notification toggle buttons**
```typescript
iconBtn: {
  padding: 8,
  borderRadius: 8,
  backgroundColor: theme.colors.surfaceAlt,
},
```

- [ ] **Step 3: Redesign "Add Class" form card**
```typescript
addFormCard: {
  backgroundColor: theme.colors.surface,
  borderRadius: 14,
  marginHorizontal: 16,
  marginTop: 16,
  padding: 16,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
},
addFormTitle: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 18,
  color: theme.colors.navy,
  marginBottom: 14,
},
formLabel: {
  fontFamily: "DMSans_600SemiBold",
  fontSize: 12,
  color: theme.colors.textSecondary,
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: 0.5,
},
formInput: {
  backgroundColor: theme.colors.surfaceAlt,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: theme.colors.border,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontFamily: "DMSans_400Regular",
  fontSize: 15,
  color: theme.colors.text,
  marginBottom: 12,
},
addBtn: {
  backgroundColor: theme.colors.orange,
  borderRadius: 20,
  paddingVertical: 13,
  alignItems: "center",
  marginTop: 4,
},
addBtnText: {
  fontFamily: "DMSans_700Bold",
  fontSize: 15,
  color: "#fff",
},
```

- [ ] **Step 4: Verify class add/delete flow works visually**
- [ ] **Step 5: Commit**
```bash
git add mobile/app/\(tabs\)/schedule.tsx
git commit -m "design: schedule class cards + add form — orange accent, elevated"
```

---

## Chunk 3: Activity Screen

### Task 5: activity.tsx — Stats Grid & Chart

**Files:**
- Modify: `mobile/app/(tabs)/activity.tsx`

- [ ] **Step 1: Update container and scroll background**
```typescript
container: {
  flex: 1,
  backgroundColor: theme.colors.surfaceAlt,
},
```

- [ ] **Step 2: Redesign stats grid cards**
```typescript
statsGrid: {
  flexDirection: "row",
  gap: 10,
  paddingHorizontal: 16,
  paddingTop: 16,
  paddingBottom: 8,
},
statCard: {
  flex: 1,
  backgroundColor: theme.colors.surface,
  borderRadius: 14,
  padding: 14,
  alignItems: "center",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
},
statValue: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 28,
  color: theme.colors.navy,
  letterSpacing: -0.5,
},
statUnit: {
  fontFamily: "DMSans_500Medium",
  fontSize: 11,
  color: theme.colors.textMuted,
  marginTop: 1,
},
statLabel: {
  fontFamily: "DMSans_400Regular",
  fontSize: 12,
  color: theme.colors.textSecondary,
  marginTop: 4,
  textAlign: "center",
},
```

- [ ] **Step 3: Redesign 7-day bar chart section**
```typescript
chartCard: {
  backgroundColor: theme.colors.surface,
  borderRadius: 14,
  marginHorizontal: 16,
  marginVertical: 8,
  padding: 16,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
},
chartTitle: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 18,
  color: theme.colors.navy,
  marginBottom: 14,
},
barActive: {
  backgroundColor: theme.colors.orange,
  borderRadius: 4,
},
barInactive: {
  backgroundColor: theme.colors.border,
  borderRadius: 4,
},
barLabel: {
  fontFamily: "DMSans_500Medium",
  fontSize: 11,
  color: theme.colors.textMuted,
  marginTop: 4,
},
```

- [ ] **Step 4: Commit**
```bash
git add mobile/app/\(tabs\)/activity.tsx
git commit -m "design: activity stats grid + chart card — DM Serif numbers, elevated"
```

---

### Task 6: activity.tsx — AI Report & Pattern Insights

**Files:**
- Modify: `mobile/app/(tabs)/activity.tsx`

- [ ] **Step 1: Redesign AI report section card**
```typescript
reportCard: {
  backgroundColor: theme.colors.surface,
  borderRadius: 14,
  marginHorizontal: 16,
  marginVertical: 8,
  padding: 16,
  borderLeftWidth: 4,
  borderLeftColor: theme.colors.navy,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
},
reportTitle: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 18,
  color: theme.colors.navy,
  marginBottom: 10,
},
reportText: {
  fontFamily: "DMSans_400Regular",
  fontSize: 14,
  color: theme.colors.textSecondary,
  lineHeight: 22,
},
generateReportBtn: {
  backgroundColor: theme.colors.navy,
  borderRadius: 20,
  paddingVertical: 12,
  alignItems: "center",
  marginTop: 10,
  flexDirection: "row",
  justifyContent: "center",
  gap: 8,
},
generateReportBtnText: {
  fontFamily: "DMSans_700Bold",
  fontSize: 14,
  color: "#fff",
},
```

- [ ] **Step 2: Verify AI report generate button and pattern insight cards display correctly**
- [ ] **Step 3: Commit**
```bash
git add mobile/app/\(tabs\)/activity.tsx
git commit -m "design: activity report + insights — navy accent card, CTA polish"
```

---

## Chunk 4: Settings & Walk-Nav

### Task 7: settings.tsx — Section Headers & Input Fields

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1: Update container background**
```typescript
container: {
  flex: 1,
  backgroundColor: theme.colors.surfaceAlt,
},
```

- [ ] **Step 2: Redesign section cards (group settings into elevated surface cards)**

Settings should be grouped: each logical section is a card with `borderRadius: 14`, subtle shadow. Between sections, use a spacer.
```typescript
sectionCard: {
  backgroundColor: theme.colors.surface,
  borderRadius: 14,
  marginHorizontal: 16,
  marginBottom: 12,
  overflow: "hidden",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
},
sectionLabel: {
  fontFamily: "DMSans_700Bold",
  fontSize: 10,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: theme.colors.textMuted,
  paddingHorizontal: 16,
  paddingTop: 20,
  paddingBottom: 8,
},
settingRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: 16,
  paddingVertical: 14,
  borderBottomWidth: 1,
  borderBottomColor: theme.colors.border,
},
settingRowTitle: {
  fontFamily: "DMSans_500Medium",
  fontSize: 15,
  color: theme.colors.text,
},
settingRowValue: {
  fontFamily: "DMSans_400Regular",
  fontSize: 14,
  color: theme.colors.textMuted,
},
settingInput: {
  backgroundColor: theme.colors.surfaceAlt,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: theme.colors.border,
  paddingHorizontal: 12,
  paddingVertical: 9,
  fontFamily: "DMSans_400Regular",
  fontSize: 14,
  color: theme.colors.text,
  flex: 1,
},
```

- [ ] **Step 3: Update walking mode selector buttons**
```typescript
walkModeBtn: {
  flex: 1,
  paddingVertical: 10,
  alignItems: "center",
  borderRadius: 8,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.surfaceAlt,
},
walkModeBtnActive: {
  backgroundColor: theme.colors.navy,
  borderColor: theme.colors.navy,
},
walkModeBtnText: {
  fontFamily: "DMSans_600SemiBold",
  fontSize: 12,
  color: theme.colors.textMuted,
},
walkModeBtnTextActive: {
  color: "#fff",
},
```

- [ ] **Step 4: Update save/destructive action buttons**
```typescript
saveBtn: {
  backgroundColor: theme.colors.orange,
  borderRadius: 20,
  paddingVertical: 13,
  alignItems: "center",
  marginHorizontal: 16,
  marginBottom: 12,
},
saveBtnText: {
  fontFamily: "DMSans_700Bold",
  fontSize: 15,
  color: "#fff",
},
dangerBtn: {
  backgroundColor: "transparent",
  borderRadius: 20,
  paddingVertical: 13,
  alignItems: "center",
  marginHorizontal: 16,
  borderWidth: 1.5,
  borderColor: theme.colors.error,
},
dangerBtnText: {
  fontFamily: "DMSans_600SemiBold",
  fontSize: 15,
  color: theme.colors.error,
},
```

- [ ] **Step 5: Commit**
```bash
git add mobile/app/\(tabs\)/settings.tsx
git commit -m "design: settings — grouped section cards, iOS-style rows, polish"
```

---

### Task 8: walk-nav.tsx — HUD & Banner Polish

**Files:**
- Modify: `mobile/app/walk-nav.tsx`

- [ ] **Step 1: Update HUD overlay card (top bar showing destination + ETA)**
```typescript
hudCard: {
  position: "absolute",
  top: 16,
  left: 16,
  right: 16,
  zIndex: 20,
  backgroundColor: theme.colors.navy,
  borderRadius: 14,
  paddingHorizontal: 16,
  paddingVertical: 14,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.2,
  shadowRadius: 10,
  elevation: 6,
},
hudDestination: {
  fontFamily: "DMSans_600SemiBold",
  fontSize: 13,
  color: "rgba(255,255,255,0.65)",
  marginBottom: 2,
},
hudEta: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 22,
  color: "#fff",
  letterSpacing: -0.3,
},
hudMeta: {
  fontFamily: "DMSans_400Regular",
  fontSize: 12,
  color: "rgba(255,255,255,0.6)",
  marginTop: 2,
},
```

- [ ] **Step 2: Update board-bus banner**
```typescript
boardBusBanner: {
  position: "absolute",
  bottom: 120,
  left: 16,
  right: 16,
  zIndex: 20,
  backgroundColor: theme.colors.orange,
  borderRadius: 14,
  paddingHorizontal: 16,
  paddingVertical: 14,
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  shadowColor: theme.colors.orange,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.35,
  shadowRadius: 10,
  elevation: 6,
},
boardBusBannerText: {
  fontFamily: "DMSans_600SemiBold",
  fontSize: 15,
  color: "#fff",
  flex: 1,
},
boardBusBannerSub: {
  fontFamily: "DMSans_400Regular",
  fontSize: 13,
  color: "rgba(255,255,255,0.85)",
  marginTop: 2,
},
```

- [ ] **Step 3: Update stats bar at bottom (steps, distance, calories)**
```typescript
statsBar: {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  backgroundColor: theme.colors.surface,
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  paddingHorizontal: 24,
  paddingTop: 14,
  paddingBottom: 28,
  flexDirection: "row",
  justifyContent: "space-around",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.08,
  shadowRadius: 10,
  elevation: 8,
},
statsBarValue: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 22,
  color: theme.colors.navy,
  textAlign: "center",
},
statsBarLabel: {
  fontFamily: "DMSans_400Regular",
  fontSize: 11,
  color: theme.colors.textMuted,
  textAlign: "center",
  marginTop: 2,
},
```

- [ ] **Step 4: Verify walk-nav renders without overlapping elements**
- [ ] **Step 5: Commit**
```bash
git add mobile/app/walk-nav.tsx
git commit -m "design: walk-nav HUD + board-bus banner + stats bar — navy/orange polish"
```

---

## Chunk 5: Running Late & UX Polish

### Task 9: running-late.tsx — Card Redesign

**Files:**
- Modify: `mobile/app/running-late.tsx`

- [ ] **Step 1: Update container background**
```typescript
container: {
  flex: 1,
  backgroundColor: theme.colors.surfaceAlt,
},
```

- [ ] **Step 2: Update header**
```typescript
header: {
  backgroundColor: theme.colors.navy,
  paddingHorizontal: theme.spacing.lg,
  paddingTop: 24,
  paddingBottom: 18,
},
headerTitle: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 24,
  color: "#fff",
  marginBottom: 4,
},
headerSubtitle: {
  fontFamily: "DMSans_400Regular",
  fontSize: 14,
  color: "rgba(255,255,255,0.7)",
},
```

- [ ] **Step 3: Update bus cards**
```typescript
busCard: {
  backgroundColor: theme.colors.surface,
  marginHorizontal: 16,
  marginTop: 10,
  borderRadius: 14,
  padding: 16,
  borderLeftWidth: 4,
  borderLeftColor: theme.colors.orange,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.07,
  shadowRadius: 8,
  elevation: 2,
},
countdown: {
  fontFamily: "DMSans_700Bold",
  fontSize: 40,
  color: theme.colors.orange,
  letterSpacing: -1,
  lineHeight: 44,
},
navigateBtn: {
  backgroundColor: theme.colors.navy,
  borderRadius: 20,
  paddingVertical: 11,
  alignItems: "center",
  flexDirection: "row",
  justifyContent: "center",
  gap: 8,
  marginTop: 12,
},
navigateBtnText: {
  fontFamily: "DMSans_700Bold",
  fontSize: 14,
  color: "#fff",
},
```

- [ ] **Step 4: Commit**
```bash
git add mobile/app/running-late.tsx
git commit -m "design: running-late — 40px countdown hero, elevated cards, navy nav btn"
```

---

### Task 10: UX Polish — Tab Bar Header Titles

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx`

Context: Tab screens use `<Stack.Screen options={{ title: "..." }}>`. The header should use DM Serif Display for the title text on all tab screens.

- [ ] **Step 1: Verify current tab layout header config**

Read `mobile/app/(tabs)/_layout.tsx` lines 1-80 to confirm current `headerTitleStyle`.

- [ ] **Step 2: Ensure all tab screen headers use DM Serif**

In the Tabs navigator `screenOptions`, confirm:
```typescript
headerTitleStyle: {
  fontFamily: "DMSerifDisplay_400Regular",
  fontSize: 20,
  color: "#fff",
},
headerStyle: {
  backgroundColor: theme.colors.navy,
},
headerTintColor: "#fff",
```

- [ ] **Step 3: Verify each tab's header looks correct on simulator**
- [ ] **Step 4: Commit**
```bash
git add mobile/app/\(tabs\)/_layout.tsx
git commit -m "design: all tab headers use DM Serif Display + navy background"
```

---

### Task 11: UX Polish — Empty States

**Files:**
- Modify: `mobile/app/(tabs)/schedule.tsx`, `mobile/app/(tabs)/favorites.tsx`

- [ ] **Step 1: Add a proper empty state to schedule.tsx when no classes**

When `classes.length === 0`, show:
```tsx
<View style={styles.emptyState}>
  <CalendarDays size={40} color={theme.colors.border} />
  <Text style={styles.emptyStateTitle}>No classes yet</Text>
  <Text style={styles.emptyStateSub}>Add your first class using the form below</Text>
</View>
```
```typescript
emptyState: {
  alignItems: "center",
  paddingVertical: 48,
  gap: 10,
},
emptyStateTitle: {
  fontFamily: "DMSans_600SemiBold",
  fontSize: 17,
  color: theme.colors.navy,
},
emptyStateSub: {
  fontFamily: "DMSans_400Regular",
  fontSize: 14,
  color: theme.colors.textMuted,
  textAlign: "center",
  paddingHorizontal: 32,
},
```

- [ ] **Step 2: Add a proper empty state to favorites.tsx**

```tsx
<View style={styles.emptyState}>
  <Star size={40} color={theme.colors.border} />
  <Text style={styles.emptyStateTitle}>No saved places</Text>
  <Text style={styles.emptyStateSub}>Star a place in search results to save it here</Text>
</View>
```

- [ ] **Step 3: Verify empty states render with correct icon import (`CalendarDays`, `Star` from lucide)**
- [ ] **Step 4: Commit**
```bash
git add mobile/app/\(tabs\)/schedule.tsx mobile/app/\(tabs\)/favorites.tsx
git commit -m "ux: proper empty states — Lucide icons, helpful copy, no emoji"
```

---

## Verification Checklist

Before marking sprint complete, verify each screen visually on simulator:

- [ ] **map.tsx**: Search bar floats at top; suggestions overlay map; bottom sheet slides up with drag handle; departure rows match index.tsx style
- [ ] **schedule.tsx**: Day pills are compact with navy active state; class cards have orange left border and shadow; add form uses rounded inputs
- [ ] **activity.tsx**: Stats use DM Serif numbers; chart bars are orange (today) / border (other); AI report card has navy left border
- [ ] **settings.tsx**: Sections grouped in cards with muted uppercase labels; walking mode uses 4 compact toggle buttons; save = orange pill, reset = outlined error button
- [ ] **walk-nav.tsx**: HUD is navy card at top with DM Serif ETA; board-bus banner is orange with shadow; stats bar is white rounded drawer at bottom
- [ ] **running-late.tsx**: Header is navy; bus cards have 40px orange countdown; navigate button is rounded navy pill
- [ ] **All screens**: No Ionicons (verify: `grep -r "Ionicons" mobile/` should return empty)
- [ ] **All screens**: No system fonts — no `fontFamily: "System"` or unset fontFamily on visible text

```bash
grep -r "Ionicons" /Users/25ruhans/UIUC_APP/mobile/
grep -r "fontFamily.*System" /Users/25ruhans/UIUC_APP/mobile/src/
```

---

## Sprint Summary

| Task | Screen | Type | Est. effort |
|------|--------|------|------------|
| 1 | map.tsx | Search bar + overlay | Small |
| 2 | map.tsx | Bottom sheet + CTAs | Small |
| 3 | schedule.tsx | Header + day selector | Small |
| 4 | schedule.tsx | Class cards + add form | Medium |
| 5 | activity.tsx | Stats grid + chart | Small |
| 6 | activity.tsx | AI report + insights | Small |
| 7 | settings.tsx | Section cards + inputs | Medium |
| 8 | walk-nav.tsx | HUD + banners + stats | Medium |
| 9 | running-late.tsx | Card redesign | Small |
| 10 | _layout.tsx | Header titles | Tiny |
| 11 | schedule + favorites | Empty states | Small |

**11 tasks — all independently mergeable. Zero backend changes required.**
