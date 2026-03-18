import { useQuery } from "@tanstack/react-query";
import { fetchDepartures, fetchNearbyStops } from "@/src/api/client";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

export function useDepartures(
  stopId: string,
  options?: { enabled?: boolean }
) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["departures", stopId],
    queryFn: () => fetchDepartures(apiBaseUrl, stopId, 60, { apiKey }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: (options?.enabled ?? true) && !!apiBaseUrl && !!stopId,
  });
}

export function useNearbyStops(
  lat: number,
  lng: number,
  options?: { enabled?: boolean }
) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["nearby-stops", lat, lng],
    queryFn: () => fetchNearbyStops(apiBaseUrl, lat, lng, 800, { apiKey }),
    staleTime: 60_000,
    enabled:
      (options?.enabled ?? true) &&
      !!apiBaseUrl &&
      lat !== 0 &&
      lng !== 0,
  });
}
