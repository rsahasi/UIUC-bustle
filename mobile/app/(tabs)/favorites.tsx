import {
  addFavoritePlace,
  addFavoriteStop,
  getAfterLastClassPlaceId,
  getFavoritePlaces,
  getFavoriteStops,
  removeFavoritePlace,
  removeFavoriteStop,
  setAfterLastClassPlaceId,
  type FavoriteStop,
  type SavedPlace,
} from "@/src/storage/favorites";
import { FadeInView, PressableScale } from "@/src/components/ui/motion";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Check, MapPin, Plus, Star, Trash2 } from "lucide-react-native";
import { theme } from "@/src/constants/theme";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

// ── Render-only pieces ─────────────────────────────────────────────────────

/** Springy selector chip — selected state pairs the fill with a check glyph. */
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <PressableScale
      scaleTo={0.9}
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      {selected && <Check size={13} strokeWidth={3} color={theme.colors.surface} />}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

export default function FavoritesScreen() {
  const router = useRouter();
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [stops, setStops] = useState<FavoriteStop[]>([]);
  const [afterLastClassId, setAfterLastClassId] = useState("");
  const [loading, setLoading] = useState(true);
  const [addingPlace, setAddingPlace] = useState(false);
  const [newPlaceName, setNewPlaceName] = useState("");

  const load = useCallback(async () => {
    const [p, s, a] = await Promise.all([
      getFavoritePlaces(),
      getFavoriteStops(),
      getAfterLastClassPlaceId(),
    ]);
    setPlaces(p);
    setStops(s);
    setAfterLastClassId(a);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addPlaceWithLocation = useCallback(async () => {
    const name = newPlaceName.trim() || "Saved place";
    setAddingPlace(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Need location", "Allow location to add a place.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const place = await addFavoritePlace({
        name,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
      setPlaces((prev) => [...prev, place]);
      setNewPlaceName("");
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not add place.");
    } finally {
      setAddingPlace(false);
    }
  }, [newPlaceName]);

  const removePlace = useCallback(async (id: string) => {
    await removeFavoritePlace(id);
    setPlaces((prev) => prev.filter((p) => p.id !== id));
    if (afterLastClassId === id) setAfterLastClassId(await getAfterLastClassPlaceId());
  }, [afterLastClassId]);

  const removeStop = useCallback(async (stopId: string) => {
    await removeFavoriteStop(stopId);
    setStops((prev) => prev.filter((s) => s.stop_id !== stopId));
  }, []);

  const setAfterLastClass = useCallback(async (placeId: string) => {
    await setAfterLastClassPlaceId(placeId);
    setAfterLastClassId(placeId);
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.navy} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <FadeInView delay={0}>
        <Text style={styles.sectionLabel} accessibilityRole="header">After last class I go to</Text>
        <View style={styles.sectionCard}>
          <View style={styles.afterRow}>
            <Chip label="None" selected={afterLastClassId === ""} onPress={() => setAfterLastClass("")} />
            {places.map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                selected={afterLastClassId === p.id}
                onPress={() => setAfterLastClass(p.id)}
              />
            ))}
          </View>
        </View>
      </FadeInView>

      <FadeInView delay={70}>
        <Text style={styles.sectionLabel} accessibilityRole="header">Saved places</Text>
        <Text style={styles.hint}>Save spots like the gym or a friend's place — we'll recommend the best bus route from Home, and you can use them for "After last class."</Text>
        {addingPlace ? (
          <View style={styles.addCard}>
            <TextInput
              placeholder="Place name (e.g. Gym, McDonald's)"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
              value={newPlaceName}
              onChangeText={setNewPlaceName}
            />
            <PressableScale
              style={styles.addBtnWrap}
              onPress={addPlaceWithLocation}
              disabled={addingPlace}
              accessibilityRole="button"
              accessibilityLabel="Use my location"
            >
              <LinearGradient
                colors={[theme.gradients.sunset[0], theme.gradients.sunset[1]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.addBtn}
              >
                <MapPin size={15} color={theme.colors.surface} strokeWidth={2.2} />
                <Text style={styles.addBtnText}>Use my location</Text>
              </LinearGradient>
            </PressableScale>
            <PressableScale
              haptic={false}
              style={styles.cancelBtn}
              onPress={() => { setAddingPlace(false); setNewPlaceName(""); }}
              accessibilityRole="button"
              accessibilityLabel="Cancel adding a place"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </PressableScale>
          </View>
        ) : (
          <PressableScale
            style={styles.addPlaceBtn}
            onPress={() => setAddingPlace(true)}
            accessibilityRole="button"
            accessibilityLabel="Add place"
          >
            <Plus size={16} color={theme.colors.brandInk} strokeWidth={2.2} />
            <Text style={styles.addPlaceBtnText}>Add place</Text>
          </PressableScale>
        )}
      </FadeInView>
      {places.length === 0 && !addingPlace && (
        <FadeInView delay={100} style={styles.emptyCard}>
          <EmptyState
            icon={MapPin}
            title="No saved places yet"
            subtitle={'Tap "Add place" while you’re at the gym, work, or a friend’s to save the spot.'}
          />
        </FadeInView>
      )}
      {places.map((p, i) => (
        <FadeInView key={p.id} delay={100 + i * 60}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconCircle}>
                <MapPin size={16} color={theme.colors.brandInk} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.placeName}>{p.name}</Text>
                <Text style={styles.placeCoords}>{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</Text>
              </View>
            </View>
            <View style={styles.cardRow}>
              <PressableScale
                style={styles.linkBtn}
                onPress={() => router.push("/(tabs)")}
                accessibilityRole="button"
                accessibilityLabel={`Open Home for routes to ${p.name}`}
              >
                <Text style={styles.linkBtnText}>Open Home for routes</Text>
              </PressableScale>
              <PressableScale
                style={styles.removeBtn}
                onPress={() => removePlace(p.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${p.name} from saved places`}
              >
                <Trash2 size={13} color={theme.colors.errorDeep} strokeWidth={2.2} />
                <Text style={styles.removeBtnText}>Remove</Text>
              </PressableScale>
            </View>
          </View>
        </FadeInView>
      ))}

      <FadeInView delay={140}>
        <Text style={styles.sectionLabel} accessibilityRole="header">Favorite stops</Text>
        <Text style={styles.hint}>Add stops from Home or Map. Quick access to departures.</Text>
        {stops.length === 0 && (
          <View style={styles.emptyCard}>
            <EmptyState
              icon={Star}
              title="No favorite stops yet"
              subtitle="Tap the star on any stop in Home or Map for one-tap departures."
            />
          </View>
        )}
      </FadeInView>
      {stops.map((s, i) => (
        <FadeInView key={s.stop_id} delay={170 + i * 60}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconCircle}>
                <Star size={16} color={theme.colors.brandInk} strokeWidth={2} />
              </View>
              <Text style={[styles.stopName, { flex: 1 }]}>{s.stop_name}</Text>
            </View>
            <View style={styles.cardRow}>
              <PressableScale
                style={styles.linkBtn}
                onPress={() => router.push({ pathname: "/trip", params: { stop_id: s.stop_id, stop_name: s.stop_name } })}
                accessibilityRole="button"
                accessibilityLabel={`Departures from ${s.stop_name}`}
              >
                <Text style={styles.linkBtnText}>Departures</Text>
              </PressableScale>
              <PressableScale
                style={styles.removeBtn}
                onPress={() => removeStop(s.stop_id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${s.stop_name} from favorite stops`}
              >
                <Trash2 size={13} color={theme.colors.errorDeep} strokeWidth={2.2} />
                <Text style={styles.removeBtnText}>Remove</Text>
              </PressableScale>
            </View>
          </View>
        </FadeInView>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.surfaceAlt },
  container: { padding: theme.layout.gutter, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.surfaceAlt },
  sectionLabel: { ...theme.text.eyebrow, color: theme.colors.textMuted, marginTop: theme.layout.gutter, marginBottom: theme.spacing.sm, marginLeft: 4 },
  hint: { ...theme.text.caption, color: theme.colors.textSecondary, marginBottom: theme.layout.cardGap, marginLeft: 4 },
  sectionCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: theme.layout.gutter, ...theme.elevation[2] },
  afterRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minHeight: theme.layout.tapMin,
    paddingHorizontal: theme.layout.gutter,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.orangeSoft,
  },
  chipSelected: { backgroundColor: theme.colors.ctaEnd, ...theme.shadows.glowOrange },
  chipText: { ...theme.text.subhead, fontSize: 14, color: theme.colors.brandInk },
  chipTextSelected: { color: theme.colors.surface },
  addCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: theme.layout.gutter, marginBottom: theme.layout.cardGap, ...theme.elevation[2] },
  input: {
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    borderRadius: theme.radius.lg,
    padding: 12,
    marginBottom: 10,
    minHeight: theme.layout.tapMin,
    ...theme.text.body,
    fontSize: 16,
    color: theme.colors.text,
  },
  addBtnWrap: { borderRadius: theme.radius.lg, ...theme.shadows.glowOrange, marginBottom: 4 },
  addBtn: {
    flexDirection: "row",
    gap: 7,
    padding: 14,
    minHeight: theme.layout.tapMin,
    borderRadius: theme.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { ...theme.text.subhead, color: theme.colors.surface },
  cancelBtn: { alignItems: "center", justifyContent: "center", minHeight: theme.layout.tapMin, padding: 10 },
  cancelBtnText: { ...theme.text.body, fontSize: 14, color: theme.colors.textSecondary },
  addPlaceBtn: {
    flexDirection: "row",
    gap: 6,
    minHeight: theme.layout.tapMin,
    padding: theme.layout.gutter,
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.orange,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.layout.cardGap,
    backgroundColor: theme.colors.surface,
  },
  addPlaceBtnText: { ...theme.text.subhead, color: theme.colors.brandInk },
  emptyCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, marginBottom: theme.layout.cardGap, ...theme.elevation[1] },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: theme.layout.gutter, marginBottom: 10, ...theme.elevation[2] },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.orangeSoft, alignItems: "center", justifyContent: "center" },
  placeName: { ...theme.text.heading, fontSize: 16, color: theme.colors.navy },
  placeCoords: { ...theme.text.caption, fontSize: 12, color: theme.colors.textMuted, marginTop: 1, fontVariant: ["tabular-nums" as const] },
  stopName: { ...theme.text.heading, fontSize: 16, color: theme.colors.navy },
  cardRow: { flexDirection: "row", marginTop: theme.spacing.md, gap: 10, alignItems: "center" },
  linkBtn: {
    minHeight: theme.layout.tapMin,
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: theme.layout.gutter,
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.pill,
  },
  linkBtnText: { ...theme.text.subhead, fontSize: 14, color: theme.colors.surface },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minHeight: theme.layout.tapMin,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.errorSoft,
    borderRadius: theme.radius.pill,
  },
  removeBtnText: { ...theme.text.subhead, fontSize: 14, color: theme.colors.errorDeep },
});
