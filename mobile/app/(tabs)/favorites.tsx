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
import { MapPin, Plus, Star } from "lucide-react-native";
import { theme } from "@/src/constants/theme";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionTitle}>After last class I go to</Text>
      <View style={styles.afterRow}>
        <Pressable
          style={[styles.chip, afterLastClassId === "" && styles.chipSelected]}
          onPress={() => setAfterLastClass("")}
        >
          <Text style={[styles.chipText, afterLastClassId === "" && styles.chipTextSelected]}>None</Text>
        </Pressable>
        {places.map((p) => (
          <Pressable
            key={p.id}
            style={[styles.chip, afterLastClassId === p.id && styles.chipSelected]}
            onPress={() => setAfterLastClass(p.id)}
          >
            <Text style={[styles.chipText, afterLastClassId === p.id && styles.chipTextSelected]}>{p.name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Saved places</Text>
      <Text style={styles.hint}>Use for “After last class” or Get bus routes to any place—gym, McDonald's, a friend's. Save a spot and we'll recommend the best route from Home. Use for "After last class" too.</Text>
      {addingPlace ? (
        <View style={styles.addRow}>
          <TextInput
            placeholder="Place name (e.g. Gym, McDonald's)"
            placeholderTextColor="#999"
            style={styles.input}
            value={newPlaceName}
            onChangeText={setNewPlaceName}
          />
          <Pressable style={styles.addBtn} onPress={addPlaceWithLocation} disabled={addingPlace}>
            <Text style={styles.addBtnText}>Use my location</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={() => { setAddingPlace(false); setNewPlaceName(""); }}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.addPlaceBtn} onPress={() => setAddingPlace(true)}>
          <Plus size={16} color={theme.colors.orange} style={{ marginRight: 6 }} />
          <Text style={styles.addPlaceBtnText}>Add place</Text>
        </Pressable>
      )}
      {places.map((p) => (
        <View key={p.id} style={styles.card}>
          <Text style={styles.placeName}>{p.name}</Text>
          <Text style={styles.placeCoords}>{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</Text>
          <View style={styles.cardRow}>
            <Pressable style={styles.linkBtn} onPress={() => router.push("/(tabs)")}>
              <Text style={styles.linkBtnText}>Open Home for routes</Text>
            </Pressable>
            <Pressable style={styles.removeBtn} onPress={() => removePlace(p.id)}>
              <Text style={styles.removeBtnText}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Favorite stops</Text>
      <Text style={styles.hint}>Add stops from Home or Map. Quick access to departures.</Text>
      {stops.length === 0 ? (
        <View style={styles.emptyState}>
          <Star size={28} color={theme.colors.textMuted} style={{ marginBottom: 8 }} />
          <Text style={styles.empty}>No favorite stops yet.</Text>
          <Text style={styles.emptyHint}>Tap the star on any stop in Home or Map.</Text>
        </View>
      ) : (
        stops.map((s) => (
          <View key={s.stop_id} style={styles.card}>
            <Text style={styles.stopName}>{s.stop_name}</Text>
            <View style={styles.cardRow}>
              <Pressable
                style={styles.linkBtn}
                onPress={() => router.push({ pathname: "/trip", params: { stop_id: s.stop_id, stop_name: s.stop_name } })}
              >
                <Text style={styles.linkBtnText}>Departures</Text>
              </Pressable>
              <Pressable style={styles.removeBtn} onPress={() => removeStop(s.stop_id)}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  sectionTitle: { fontSize: 18, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy, marginTop: 16, marginBottom: 8 },
  hint: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginBottom: 12 },
  afterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceAlt },
  chipSelected: { backgroundColor: theme.colors.navy },
  chipText: { fontSize: 14, fontFamily: "DMSans_500Medium", color: theme.colors.text },
  chipTextSelected: { color: theme.colors.surface },
  addRow: { marginBottom: 12 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 12, marginBottom: 8, fontSize: 16, fontFamily: "DMSans_400Regular" },
  addBtn: { backgroundColor: theme.colors.navy, padding: 12, borderRadius: theme.radius.md, alignItems: "center", marginBottom: 8 },
  addBtnText: { color: theme.colors.surface, fontFamily: "DMSans_600SemiBold", fontSize: 15 },
  cancelBtn: { alignItems: "center" },
  cancelBtnText: { color: theme.colors.textSecondary, fontSize: 14, fontFamily: "DMSans_400Regular" },
  addPlaceBtn: { flexDirection: "row", padding: 14, borderRadius: theme.radius.md, borderWidth: 1.5, borderColor: theme.colors.orange, borderStyle: "dashed", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  addPlaceBtnText: { color: theme.colors.orange, fontFamily: "DMSans_600SemiBold", fontSize: 15 },
  emptyState: { alignItems: "center", paddingVertical: 20, marginBottom: 12 },
  emptyHint: { fontSize: 13, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted, marginTop: 4 },
  card: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.lg, padding: 14, marginBottom: 10 },
  placeName: { fontSize: 16, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy },
  placeCoords: { fontSize: 12, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginTop: 4 },
  stopName: { fontSize: 16, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy },
  cardRow: { flexDirection: "row", marginTop: 10, gap: 12 },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: theme.colors.navy, borderRadius: theme.radius.md },
  linkBtnText: { color: theme.colors.surface, fontSize: 14, fontFamily: "DMSans_600SemiBold" },
  removeBtn: { paddingVertical: 8, paddingHorizontal: 12, justifyContent: "center" },
  removeBtnText: { color: theme.colors.error, fontSize: 14, fontFamily: "DMSans_400Regular" },
  empty: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginBottom: 16 },
});
