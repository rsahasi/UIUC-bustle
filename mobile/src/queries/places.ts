import { useQuery } from "@tanstack/react-query";
import {
  fetchAutocomplete,
  fetchGeocode,
  fetchPlaceDetails,
  fetchPlacesAutocomplete,
} from "@/src/api/client";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

export function useAutocomplete(query: string) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["autocomplete", query],
    queryFn: () => fetchAutocomplete(apiBaseUrl, query, { apiKey }),
    staleTime: 10_000,
    enabled: !!apiBaseUrl && query.length >= 2,
  });
}

export function usePlacesAutocomplete(query: string, sessionToken?: string) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["places-autocomplete", query],
    queryFn: () =>
      fetchPlacesAutocomplete(apiBaseUrl, query, sessionToken, { apiKey }),
    staleTime: 10_000,
    enabled: !!apiBaseUrl && query.length >= 2,
  });
}

export function usePlaceDetails(placeId: string | null) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["place-details", placeId],
    queryFn: () => fetchPlaceDetails(apiBaseUrl, placeId!, { apiKey }),
    staleTime: Infinity,
    enabled: !!apiBaseUrl && !!placeId,
  });
}

export function useGeocode(query: string | null) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["geocode", query],
    queryFn: () => fetchGeocode(apiBaseUrl, query!, { apiKey }),
    staleTime: 86_400_000,
    enabled: !!apiBaseUrl && !!query,
  });
}
