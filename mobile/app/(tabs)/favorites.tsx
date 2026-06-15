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
import { MapPin, Plus, Star } from "lucide-react-native";
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
        <Text style={styles.sectionLabel}>After last class I go to</Text>
        <View style={styles.sectionCard}>
          <View style={styles.afterRow}>
            <PressableScale
              scaleTo={0.93}
              style={[styles.chip, afterLastClassId === "" && styles.chipSelected]}
              onPress={() => setAfterLastClass("")}
            >
              <Text style={[styles.chipText, afterLastClassId === "" && styles.chipTextSelected]}>None</Text>
            </PressableScale>
            {places.map((p) => (
              <PressableScale
                key={p.id}
                scaleTo={0.93}
                style={[styles.chip, afterLastClassId === p.id && styles.chipSelected]}
                onPress={() => setAfterLastClass(p.id)}
              >
                <Text style={[styles.chipText, afterLastClassId === p.id && styles.chipTextSelected]}>{p.name}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
      </FadeInView>

      <FadeInView delay={70}>
        <Text style={styles.sectionLabel}>Saved places</Text>
        <Text style={styles.hint}>Use for “After last class” or Get bus routes to any place—gym, McDonald's, a friend's. Save a spot and we'll recommend the best route from Home. Use for "After last class" too.</Text>
        {addingPlace ? (
          <View style={styles.addCard}>
            <TextInput
              placeholder="Place name (e.g. Gym, McDonald's)"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
              value={newPlaceName}
              onChangeText={setNewPlaceName}
            />
            <PressableScale style={styles.addBtnWrap} onPress={addPlaceWithLocation} disabled={addingPlace}>
              <LinearGradient
                colors={[theme.gradients.sunset[0], theme.gradients.sunset[1]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.addBtn}
              >
                <Text style={styles.addBtnText}>Use my location</Text>
              </LinearGradient>
            </PressableScale>
            <PressableScale haptic={false} style={styles.cancelBtn} onPress={() => { setAddingPlace(false); setNewPlaceName(""); }}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </PressableScale>
          </View>
        ) : (
          <PressableScale style={styles.addPlaceBtn} onPress={() => setAddingPlace(true)}>
            <Plus size={16} color={theme.colors.orange} style={{ marginRight: 6 }} />
            <Text style={styles.addPlaceBtnText}>Add place</Text>
          </PressableScale>
        )}
      </FadeInView>
      {places.map((p, i) => (
        <FadeInView key={p.id} delay={100 + i * 60}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconCircle}>
                <MapPin size={16} color={theme.colors.orange} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.placeName}>{p.name}</Text>
                <Text style={styles.placeCoords}>{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</Text>
              </View>
            </View>
            <View style={styles.cardRow}>
              <PressableScale style={styles.linkBtn} onPress={() => router.push("/(tabs)")}>
                <Text style={styles.linkBtnText}>Open Home for routes</Text>
              </PressableScale>
              <PressableScale style={styles.removeBtn} onPress={() => removePlace(p.id)}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </PressableScale>
            </View>
          </View>
        </FadeInView>
      ))}

      <FadeInView delay={140}>
        <Text style={styles.sectionLabel}>Favorite stops</Text>
        <Text style={styles.hint}>Add stops from Home or Map. Quick access to departures.</Text>
        {stops.length === 0 && (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <Star size={24} color={theme.colors.orange} />
            </View>
            <Text style={styles.empty}>No favorite stops yet.</Text>
            <Text style={styles.emptyHint}>Tap the star on any stop in Home or Map.</Text>
          </View>
        )}
      </FadeInView>
      {stops.map((s, i) => (
        <FadeInView key={s.stop_id} delay={170 + i * 60}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconCircle}>
                <Star size={16} color={theme.colors.orange} />
              </View>
              <Text style={[styles.stopName, { flex: 1 }]}>{s.stop_name}</Text>
            </View>
            <View style={styles.cardRow}>
              <PressableScale
                style={styles.linkBtn}
                onPress={() => router.push({ pathname: "/trip", params: { stop_id: s.stop_id, stop_name: s.stop_name } })}
              >
                <Text style={styles.linkBtnText}>Departures</Text>
              </PressableScale>
              <PressableScale style={styles.removeBtn} onPress={() => removeStop(s.stop_id)}>
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
  container: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.surfaceAlt },
  sectionLabel: { fontSize: 11, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase", color: theme.colors.textMuted, marginTop: 16, marginBottom: 8, marginLeft: 4 },
  hint: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginBottom: 12, marginLeft: 4 },
  sectionCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 16, ...theme.shadows.md },
  afterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: theme.radius.pill, backgroundColor: theme.colors.orangeSoft },
  chipSelected: { backgroundColor: theme.colors.orange, ...theme.shadows.glowOrange },
  chipText: { fontSize: 14, fontFamily: "DMSans_500Medium", color: theme.colors.orange },
  chipTextSelected: { color: theme.colors.surface, fontFamily: "DMSans_600SemiBold" },
  addCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 16, marginBottom: 12, ...theme.shadows.md },
  input: { backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.borderSoft, borderRadius: theme.radius.lg, padding: 12, marginBottom: 10, fontSize: 16, fontFamily: "DMSans_400Regular", color: theme.colors.text },
  addBtnWrap: { borderRadius: theme.radius.lg, ...theme.shadows.glowOrange, marginBottom: 4 },
  addBtn: { padding: 14, borderRadius: theme.radius.lg, alignItems: "center" },
  addBtnText: { color: theme.colors.surface, fontFamily: "DMSans_600SemiBold", fontSize: 15 },
  cancelBtn: { alignItems: "center", padding: 10 },
  cancelBtnText: { color: theme.colors.textSecondary, fontSize: 14, fontFamily: "DMSans_400Regular" },
  addPlaceBtn: { flexDirection: "row", padding: 16, borderRadius: theme.radius.lg, borderWidth: 1.5, borderColor: theme.colors.orange, borderStyle: "dashed", alignItems: "center", justifyContent: "center", marginBottom: 12, backgroundColor: theme.colors.surface },
  addPlaceBtnText: { color: theme.colors.orange, fontFamily: "DMSans_600SemiBold", fontSize: 15 },
  emptyCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 24, alignItems: "center", ...theme.shadows.md },
  emptyIconCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.orangeSoft, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  empty: { fontSize: 14, fontFamily: "DMSans_600SemiBold", color: theme.colors.textSecondary },
  emptyHint: { fontSize: 13, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted, marginTop: 4 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 16, marginBottom: 10, ...theme.shadows.md },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.orangeSoft, alignItems: "center", justifyContent: "center" },
  placeName: { fontSize: 16, fontFamily: "DMSans_700Bold", color: theme.colors.navy },
  placeCoords: { fontSize: 12, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted, marginTop: 2 },
  stopName: { fontSize: 16, fontFamily: "DMSans_700Bold", color: theme.colors.navy },
  cardRow: { flexDirection: "row", marginTop: 12, gap: 10, alignItems: "center" },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: theme.colors.navy, borderRadius: theme.radius.pill },
  linkBtnText: { color: theme.colors.surface, fontSize: 14, fontFamily: "DMSans_600SemiBold" },
  removeBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: theme.colors.errorSoft, borderRadius: theme.radius.pill },
  removeBtnText: { color: theme.colors.error, fontSize: 14, fontFamily: "DMSans_600SemiBold" },
});
