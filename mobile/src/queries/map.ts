import { useQuery } from "@tanstack/react-query";
import { fetchBusRouteStops, fetchVehicles, fetchWalkingRoute } from "@/src/api/client";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

export function useVehicles(options?: { enabled?: boolean }) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["vehicles"],
    queryFn: () => fetchVehicles(apiBaseUrl, undefined, { apiKey }),
    staleTime: 10_000,
    refetchInterval: 15_000,
    enabled: (options?.enabled ?? true) && !!apiBaseUrl,
  });
}

export function useWalkingRoute(
  origLat: number,
  origLng: number,
  destLat: number,
  destLng: number,
  options?: { enabled?: boolean }
) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["walking-route", origLat, origLng, destLat, destLng],
    queryFn: () =>
      fetchWalkingRoute(apiBaseUrl, origLat, origLng, destLat, destLng, { apiKey }),
    staleTime: 300_000,
    enabled:
      (options?.enabled ?? true) &&
      !!apiBaseUrl &&
      origLat !== 0 &&
      origLng !== 0 &&
      destLat !== 0 &&
      destLng !== 0,
  });
}

export function useBusRouteStops(
  routeId: string,
  fromStopId: string,
  toStopId: string,
  afterTime: string,
  options?: { enabled?: boolean }
) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["bus-route-stops", routeId, fromStopId, toStopId, afterTime],
    queryFn: () =>
      fetchBusRouteStops(apiBaseUrl, routeId, fromStopId, toStopId, afterTime, { apiKey }),
    staleTime: 300_000,
    enabled:
      (options?.enabled ?? true) &&
      !!apiBaseUrl &&
      !!routeId &&
      !!fromStopId &&
      !!toStopId,
  });
}
