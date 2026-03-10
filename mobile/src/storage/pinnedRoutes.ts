import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@uiuc_bus_pinned_routes";

export interface PinnedRoute {
  id: string;
  destName: string;
  destLat: number;
  destLng: number;
}

export async function getPinnedRoutes(): Promise<PinnedRoute[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function addPinnedRoute(route: Omit<PinnedRoute, "id">): Promise<PinnedRoute> {
  const routes = await getPinnedRoutes();
  // Deduplicate by destName
  if (routes.some((r) => r.destName === route.destName)) return routes.find((r) => r.destName === route.destName)!;
  const id = `pin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const newRoute: PinnedRoute = { ...route, id };
  await AsyncStorage.setItem(KEY, JSON.stringify([...routes, newRoute]));
  return newRoute;
}

export async function removePinnedRoute(id: string): Promise<void> {
  const routes = (await getPinnedRoutes()).filter((r) => r.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(routes));
}
