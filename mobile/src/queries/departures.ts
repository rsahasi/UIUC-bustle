import { useQuery } from "@tanstack/react-query";
import { fetchDepartures, fetchNearbyStops } from "@/src/api/client";
import type { StopWithDistance } from "@/src/api/types";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

// GPS fixes jitter at the ~1e-5 degree level; 4 decimals (~11 m) keeps successive
// refreshes at the same spot on one cache entry instead of minting a new one per fix.
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function useDepartures(
  stopId: string,
  options?: { enabled?: boolean }
) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["departures", stopId, apiBaseUrl],
    queryFn: () => fetchDepartures(apiBaseUrl, stopId, 60, { apiKey }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: (options?.enabled ?? true) && !!apiBaseUrl && !!stopId,
  });
}

export function useNearbyStops(
  lat: number,
  lng: number,
  options?: { enabled?: boolean; placeholderData?: { stops: StopWithDistance[] } }
) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["nearby-stops", round4(lat), round4(lng), apiBaseUrl],
    queryFn: () => fetchNearbyStops(apiBaseUrl, lat, lng, 800, { apiKey }),
    staleTime: 60_000,
    enabled:
      (options?.enabled ?? true) &&
      !!apiBaseUrl &&
      lat !== 0 &&
      lng !== 0,
    placeholderData: options?.placeholderData,
  });
}
