# UIUC Bus App — Audit & Improvement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement high-priority bugs, security improvements, and UX fixes from the app audit prompt, focusing on items not already implemented.

**Architecture:** Changes are isolated to existing React Native (Expo Router) screens and storage modules. No new dependencies required. All fixes are purely frontend — no backend changes needed.

**Tech Stack:** React Native (Expo Router), TypeScript, AsyncStorage, expo-haptics, lucide-react-native

---

## Pre-flight: Already Implemented (skip these)

- #8 "Plan my evening" → routes to `/after-class-planner` ✅
- End time > start time validation ✅
- HH:MM regex validation on time fields ✅
- Walking mode accessibilityRole/accessibilityState ✅
- Live 30s refresh on home screen departures ✅
- Pull-to-refresh on all screens ✅
- LiveBadge pulse animation ✅

---

## Chunk 1: Schedule Form Fixes (schedule.tsx)

**Files:**
- Modify: `mobile/app/(tabs)/schedule.tsx`

### Task 1: Title input validation (max 60 chars, trim leading spaces)

- [ ] **Step 1: Add maxLength and sanitize onChangeText for title**

In `schedule.tsx`, find the Title `TextInput` (~line 321) and update:
```tsx
<TextInput
  style={styles.input}
  value={title}
  onChangeText={(text) => setTitle(text.slice(0, 60))}
  maxLength={60}
  placeholder="e.g. CS 101"
/>
```
Also update the submit validation to trim and check:
```tsx
const t = title.trim();
if (!t) { Alert.alert("Error", "Enter a title."); return; }
if (t.length > 60) { Alert.alert("Error", "Title must be 60 characters or fewer."); return; }
```
The second check is a safety net since maxLength is set. No alphanumeric enforcement needed (class names include parentheses, dashes, etc.).

- [ ] **Step 2: Commit**
```bash
git add mobile/app/(tabs)/schedule.tsx
git commit -m "fix: enforce title maxLength 60 on schedule form"
```

### Task 2: Unusual time warning (outside 07:00–22:00)

- [ ] **Step 1: Add warning in submit() after time regex passes**

After the `match` check (~line 143), add:
```tsx
// Warn on unusual time (outside 07:00–22:00)
const [timeh, timem] = time.trim().split(':').map(Number);
const totalMin = timeh * 60 + timem;
if (totalMin < 7 * 60 || totalMin >= 22 * 60) {
  const proceed = await new Promise<boolean>((resolve) => {
    Alert.alert(
      'Unusual class time',
      `${time.trim()} is outside normal class hours (7:00–22:00). Did you mean ${timeh < 12 ? timeh + 12 : timeh - 12}:${String(timem).padStart(2, '0')} ${timeh < 12 ? 'PM' : 'AM'}?`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Add anyway', onPress: () => resolve(true) },
      ]
    );
  });
  if (!proceed) return;
}
```

- [ ] **Step 2: Commit**
```bash
git add mobile/app/(tabs)/schedule.tsx
git commit -m "fix: warn when class time is outside 07:00-22:00"
```

### Task 3: Display class times in 12-hour format in the class list

- [ ] **Step 1: Add a helper function at the top of schedule.tsx**

After the existing `getLeaveByTime` function, add:
```tsx
function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`;
}
```

- [ ] **Step 2: Update classMeta display (~line 469)**

Replace:
```tsx
{c.days_of_week.join(", ")} · {c.start_time_local}
{c.end_time_local ? `–${c.end_time_local}` : ""} · {classLocationLabel(c)}
```
With:
```tsx
{c.days_of_week.join(", ")} · {to12h(c.start_time_local)}
{c.end_time_local ? `–${to12h(c.end_time_local)}` : ""} · {classLocationLabel(c)}
```

- [ ] **Step 3: Commit**
```bash
git add mobile/app/(tabs)/schedule.tsx
git commit -m "fix: display class times in 12-hour AM/PM format"
```

### Task 4: Auto-sort classes by day-order + start time

- [ ] **Step 1: Add sort before filteredClasses**

After the `filteredClasses` definition (~line 297), replace it with:
```tsx
const DAY_ORDER: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

const filteredClasses = (
  viewMode === "week" && selectedWeekDay
    ? classes.filter((c) => c.days_of_week?.includes(selectedWeekDay))
    : [...classes]
).sort((a, b) => {
  const aDay = Math.min(...(a.days_of_week ?? []).map((d) => DAY_ORDER[d] ?? 9));
  const bDay = Math.min(...(b.days_of_week ?? []).map((d) => DAY_ORDER[d] ?? 9));
  if (aDay !== bDay) return aDay - bDay;
  return a.start_time_local.localeCompare(b.start_time_local);
});
```

- [ ] **Step 2: Commit**
```bash
git add mobile/app/(tabs)/schedule.tsx
git commit -m "fix: auto-sort classes by day order and start time"
```

### Task 5: Success toast and haptic feedback on "Add class"

- [ ] **Step 1: Add expo-haptics import (already imported in index.tsx; verify it's available)**

At the top of `schedule.tsx`, add:
```tsx
import * as Haptics from 'expo-haptics';
```

- [ ] **Step 2: Add a toast state**

Add state for success toast:
```tsx
const [successToast, setSuccessToast] = useState<string | null>(null);
```

- [ ] **Step 3: Fire haptic + toast on success in submit()**

After `await load()` on success:
```tsx
await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
setSuccessToast('Class added ✓');
setTimeout(() => setSuccessToast(null), 2500);
```

- [ ] **Step 4: Render toast banner**

Above the `{error && ...}` line, add:
```tsx
{successToast && (
  <View style={styles.successToast}>
    <Text style={styles.successToastText}>{successToast}</Text>
  </View>
)}
```

Add styles:
```tsx
successToast: {
  backgroundColor: theme.colors.success,
  borderRadius: theme.radius.md,
  padding: 12,
  marginBottom: 12,
  alignItems: 'center',
},
successToastText: {
  color: '#fff',
  fontSize: 14,
  fontFamily: 'DMSans_600SemiBold',
},
```

- [ ] **Step 5: Commit**
```bash
git add mobile/app/(tabs)/schedule.tsx
git commit -m "feat: add success toast and haptic feedback on class add"
```

---

## Chunk 2: Activity Screen Fixes (activity.tsx)

**Files:**
- Modify: `mobile/app/(tabs)/activity.tsx`
- Modify: `mobile/src/storage/activityLog.ts` (for editable weekly goal)

### Task 6: AI Report one-time disclosure modal

- [ ] **Step 1: Add AsyncStorage key and state**

Add import at top if not present:
```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
```

Add state:
```tsx
const [showAiDisclosure, setShowAiDisclosure] = useState(false);
const AI_DISCLOSURE_KEY = '@uiuc_bus_ai_report_consented';
```

- [ ] **Step 2: Modify onGetReport to check consent first**

Replace the `onGetReport` callback with:
```tsx
const onGetReport = useCallback(async () => {
  const consented = await AsyncStorage.getItem(AI_DISCLOSURE_KEY);
  if (!consented) {
    setShowAiDisclosure(true);
    return;
  }
  await doGetReport();
}, [apiBaseUrl, apiKey, todayEntries]);

const doGetReport = useCallback(async () => {
  setShowAiDisclosure(false);
  setReportLoading(true);
  setReportText(null);
  setReportError(null);
  try {
    const data = await fetchEodReport(
      apiBaseUrl,
      {
        entries: todayEntries,
        total_steps: todayEntries.reduce((s, e) => s + e.stepCount, 0),
        total_calories: todayEntries.reduce((s, e) => s + e.caloriesBurned, 0),
        total_distance_m: todayEntries.reduce((s, e) => s + e.distanceM, 0),
      },
      { apiKey: apiKey ?? undefined }
    );
    setReportText(data.report ?? 'No report generated.');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    setReportError(e instanceof Error ? e.message : 'Failed to get report.');
  } finally {
    setReportLoading(false);
  }
}, [apiBaseUrl, apiKey, todayEntries]);
```

- [ ] **Step 3: Add expo-haptics import to activity.tsx**

```tsx
import * as Haptics from 'expo-haptics';
```

- [ ] **Step 4: Render disclosure modal before the report button**

Add above the `<Pressable ... onPress={onGetReport}>` block:
```tsx
{showAiDisclosure && (
  <View style={styles.disclosureCard}>
    <Text style={styles.disclosureTitle}>Before we continue</Text>
    <Text style={styles.disclosureBody}>
      To generate your report, your step count, distance, and walk history for today will be sent to an AI service. No personal identifiers are included.
    </Text>
    <View style={styles.disclosureRow}>
      <Pressable
        style={styles.disclosureDeny}
        onPress={() => setShowAiDisclosure(false)}
      >
        <Text style={styles.disclosureDenyText}>Cancel</Text>
      </Pressable>
      <Pressable
        style={styles.disclosureAllow}
        onPress={async () => {
          await AsyncStorage.setItem(AI_DISCLOSURE_KEY, '1');
          doGetReport();
        }}
      >
        <Text style={styles.disclosureAllowText}>Allow & Generate</Text>
      </Pressable>
    </View>
  </View>
)}
```

Add styles:
```tsx
disclosureCard: {
  backgroundColor: theme.colors.surfaceAlt,
  borderRadius: theme.radius.md,
  padding: 16,
  marginTop: 16,
  marginBottom: 8,
  borderWidth: 1,
  borderColor: theme.colors.border,
},
disclosureTitle: { fontSize: 15, fontFamily: 'DMSans_700Bold', color: theme.colors.navy, marginBottom: 8 },
disclosureBody: { fontSize: 13, fontFamily: 'DMSans_400Regular', color: theme.colors.textSecondary, lineHeight: 20, marginBottom: 12 },
disclosureRow: { flexDirection: 'row', gap: 10 },
disclosureDeny: { flex: 1, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
disclosureDenyText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: theme.colors.textSecondary },
disclosureAllow: { flex: 2, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.navy, alignItems: 'center' },
disclosureAllowText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: '#fff' },
```

- [ ] **Step 5: Commit**
```bash
git add mobile/app/(tabs)/activity.tsx
git commit -m "feat: add one-time AI report disclosure modal"
```

### Task 7: Make weekly step goal editable

- [ ] **Step 1: Add storage helpers to activityLog.ts**

At the end of `mobile/src/storage/activityLog.ts`, add:
```ts
const WEEKLY_GOAL_KEY = '@uiuc_bus_weekly_step_goal';

export async function getWeeklyStepGoal(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(WEEKLY_GOAL_KEY);
    if (!raw) return WEEKLY_STEP_GOAL;
    const n = parseInt(raw, 10);
    return isNaN(n) ? WEEKLY_STEP_GOAL : n;
  } catch {
    return WEEKLY_STEP_GOAL;
  }
}

export async function setWeeklyStepGoal(goal: number): Promise<void> {
  await AsyncStorage.setItem(WEEKLY_GOAL_KEY, String(Math.max(1000, goal)));
}
```

- [ ] **Step 2: Update activity.tsx to load and use stored goal**

Add state:
```tsx
const [weeklyGoal, setWeeklyGoalState] = useState(WEEKLY_STEP_GOAL);
const [editingGoal, setEditingGoal] = useState(false);
const [goalInput, setGoalInput] = useState('');
```

In `loadData`, after `setWeeklySteps`:
```tsx
const goal = await getWeeklyStepGoal();
setWeeklyGoalState(goal);
```

Update all references from `WEEKLY_STEP_GOAL` to `weeklyGoal`.

- [ ] **Step 3: Make the goal number tappable in the weekly card**

Replace the static fraction text with:
```tsx
<Pressable onPress={() => { setGoalInput(String(weeklyGoal)); setEditingGoal(true); }}>
  <Text style={styles.weeklyFraction}>
    {weeklySteps.toLocaleString()} / {weeklyGoal.toLocaleString()} ✎
  </Text>
</Pressable>
```

Add an inline edit modal/Alert when editingGoal is true (use Alert.prompt on iOS):
```tsx
useEffect(() => {
  if (!editingGoal) return;
  Alert.prompt(
    'Weekly step goal',
    'Enter your weekly step goal (e.g. 50000)',
    [
      { text: 'Cancel', onPress: () => setEditingGoal(false), style: 'cancel' },
      {
        text: 'Save',
        onPress: async (val) => {
          const n = parseInt(val ?? '', 10);
          if (!isNaN(n) && n >= 1000) {
            await setWeeklyStepGoal(n);
            setWeeklyGoalState(n);
          }
          setEditingGoal(false);
        },
      },
    ],
    'plain-text',
    String(weeklyGoal)
  );
}, [editingGoal, weeklyGoal]);
```

Add import:
```tsx
import { getWeeklyStepGoal, setWeeklyStepGoal } from '@/src/storage/activityLog';
```

- [ ] **Step 4: Commit**
```bash
git add mobile/app/(tabs)/activity.tsx mobile/src/storage/activityLog.ts
git commit -m "feat: make weekly step goal editable and persisted"
```

---

## Chunk 3: Settings Screen Fixes (settings.tsx)

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`

### Task 8: Add min/max labels to sliders

- [ ] **Step 1: Update the buffer slider section**

Find the buffer slider `<View style={styles.sliderRow}>` and wrap the `<Slider>` with min/max labels:
```tsx
<View style={styles.sliderRow}>
  <View style={styles.sliderLabelRow}>
    <Text style={styles.sliderMinMax}>0 min</Text>
    <Text style={styles.sliderValue}>{Math.round(bufferSlider)} min</Text>
    <Text style={styles.sliderMinMax}>15 min</Text>
  </View>
  <Slider ... />
</View>
```

- [ ] **Step 2: Update the weight slider section**

Same pattern:
```tsx
<View style={styles.sliderRow}>
  <View style={styles.sliderLabelRow}>
    <Text style={styles.sliderMinMax}>{Math.round(MIN_WEIGHT_KG * 2.20462)} lbs</Text>
    <Text style={styles.sliderValue}>{Math.round(weightSlider * 2.20462)} lbs</Text>
    <Text style={styles.sliderMinMax}>{Math.round(MAX_WEIGHT_KG * 2.20462)} lbs</Text>
  </View>
  <Slider ... />
</View>
```

- [ ] **Step 3: Add styles**

```tsx
sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
sliderMinMax: { fontSize: 11, fontFamily: 'DMSans_400Regular', color: theme.colors.textMuted },
```

- [ ] **Step 4: Add "Stored securely on-device only" note under body weight label**

After the body weight `<Text style={styles.hint}>` line, add:
```tsx
<Text style={[styles.hint, { fontSize: 12, color: theme.colors.textMuted }]}>
  Stored on-device only. Never transmitted to any server.
</Text>
```

- [ ] **Step 5: Commit**
```bash
git add mobile/app/(tabs)/settings.tsx
git commit -m "feat: add min/max labels to settings sliders and weight privacy note"
```

### Task 9: Add app version and support link to Settings

- [ ] **Step 1: Add expo-constants import**

```tsx
import Constants from 'expo-constants';
```

- [ ] **Step 2: Add "About" section at bottom of ScrollView**

Before the closing `</ScrollView>`, add:
```tsx
<Text style={styles.sectionHeader}>About</Text>
<View style={styles.sectionCard}>
  <View style={styles.aboutRow}>
    <Text style={styles.aboutLabel}>App version</Text>
    <Text style={styles.aboutValue}>{Constants.expoConfig?.version ?? '—'}</Text>
  </View>
  <View style={[styles.aboutRow, { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 12, paddingTop: 12 }]}>
    <Pressable
      accessibilityRole="link"
      onPress={() => Linking.openURL('mailto:support@example.com?subject=UIUC%20Bus%20App%20Feedback')}
    >
      <Text style={styles.aboutLink}>Send feedback</Text>
    </Pressable>
  </View>
</View>
```

Add styles:
```tsx
aboutRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
aboutLabel: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.colors.text },
aboutValue: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.colors.textSecondary },
aboutLink: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: theme.colors.navy },
```

Add `Linking` to React Native imports.

- [ ] **Step 3: Commit**
```bash
git add mobile/app/(tabs)/settings.tsx
git commit -m "feat: add About section with app version and feedback link to Settings"
```

---

## Chunk 4: Home Screen Fixes (index.tsx)

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

### Task 10: Stale departure data warning (>2 min old shows "Estimated")

- [ ] **Step 1: Add departure timestamp tracking**

Add state:
```tsx
const [departuresFetchedAt, setDeparturesFetchedAt] = useState<number | null>(null);
```

In `refreshDepartures` and in `load`, after `setDeparturesByStop(depMap)`:
```tsx
setDeparturesFetchedAt(Date.now());
```

- [ ] **Step 2: Pass staleness info to DepartureRow rendering**

When rendering departures, compute:
```tsx
const isStale = departuresFetchedAt != null && Date.now() - departuresFetchedAt > 2 * 60 * 1000;
```

When rendering the `<LiveBadge />`, conditionally show:
```tsx
{isStale
  ? <View style={styles.staleBadge}><Text style={styles.staleBadgeText}>⚠ Estimated</Text></View>
  : <LiveBadge />}
```

Add styles:
```tsx
staleBadge: { backgroundColor: '#F5A623', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
staleBadgeText: { fontFamily: 'DMSans_600SemiBold', fontSize: 10, color: '#fff' },
```

- [ ] **Step 3: Commit**
```bash
git add mobile/app/(tabs)/index.tsx
git commit -m "fix: show stale warning badge when departure data is >2 min old"
```

### Task 11: Clear recent searches button

- [ ] **Step 1: Import clearRecentSearches**

`clearRecentSearches` is already exported from `@/src/storage/recentSearches`. Add to imports in index.tsx:
```tsx
import { addRecentSearch, clearRecentSearches, getRecentSearches, type RecentSearch } from "@/src/storage/recentSearches";
```

- [ ] **Step 2: Add clear button in the recent searches section**

Find the "Recent" section header rendering. Add a "Clear" pressable next to the "Recent" label:
```tsx
<View style={styles.recentHeader}>
  <Text style={styles.recentTitle}>Recent</Text>
  <Pressable onPress={async () => {
    await clearRecentSearches();
    setRecentSearches([]);
  }}>
    <Text style={styles.recentClearBtn}>Clear</Text>
  </Pressable>
</View>
```

Replace existing `<Text style={styles.recentTitle}>Recent</Text>` with the above.

Add styles:
```tsx
recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
recentClearBtn: { fontSize: 12, fontFamily: 'DMSans_400Regular', color: theme.colors.textMuted },
```

- [ ] **Step 3: Commit**
```bash
git add mobile/app/(tabs)/index.tsx
git commit -m "feat: add clear recent searches button"
```

---

## Chunk 5: Haptic feedback sweep

**Files:**
- Verify `expo-haptics` already imported in `index.tsx` (it is)
- Verify `expo-haptics` usage in schedule.tsx (added in Task 5)
- Modify: `mobile/app/(tabs)/index.tsx`

### Task 12: Add haptic feedback to primary actions in index.tsx

- [ ] **Step 1: Add haptic to "Get routes" / search submit**

Find the search submit handler (where `fetchRecommendation` is called via search). Add before the API call:
```tsx
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
```

- [ ] **Step 2: Add haptic to "Go" button on route cards**

Find where the walk-nav router.push is called (onStartWalk / onStartBus handlers). Add:
```tsx
await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
```

- [ ] **Step 3: Commit**
```bash
git add mobile/app/(tabs)/index.tsx
git commit -m "feat: add haptic feedback to search and Go button"
```

---

## Testing Checklist

After all changes:

- [ ] Open Schedule tab → add a class with title >60 chars (should be capped)
- [ ] Add class with time 23:00 → "Unusual class time" warning appears
- [ ] Verify class list shows times as "9:00 AM–10:15 AM" not "09:00–10:15"
- [ ] Verify classes auto-sort by day+time
- [ ] Add a class → green toast "Class added ✓" appears
- [ ] Open Activity → tap "Get AI Report" first time → disclosure modal appears
- [ ] Accept disclosure → report loads; tapping again skips modal
- [ ] Open Settings → buffer slider shows "0 min" and "15 min" at endpoints
- [ ] Body weight slider shows "194 lbs" and "728 lbs" at endpoints (88kg / 330kg range)
- [ ] "About" section shows app version
- [ ] Weekly goal shows pencil icon; tap → Alert.prompt opens to edit goal
- [ ] Wait 3 min offline → "⚠ Estimated" badge appears instead of "Live"
- [ ] Recent searches → "Clear" button removes all entries

---

## Execution Order

1. Chunk 1 (schedule.tsx) — highest user-facing impact
2. Chunk 2 (activity.tsx) — critical security/privacy item
3. Chunk 3 (settings.tsx) — quick wins
4. Chunk 4 (index.tsx) — stale data + clear recent
5. Chunk 5 (haptics sweep) — polish
