import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  fetchAutocomplete,
  fetchGeocode,
  fetchPlaceDetails,
  fetchPlacesAutocomplete,
} from "@/src/api/client";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

export function useAutocomplete(query: string) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  return useQuery({
    queryKey: ["autocomplete", debouncedQuery, apiBaseUrl],
    queryFn: () => fetchAutocomplete(apiBaseUrl, debouncedQuery, { apiKey }),
    staleTime: 10_000,
    enabled: !!apiBaseUrl && debouncedQuery.length >= 2,
  });
}

export function usePlacesAutocomplete(query: string, sessionToken?: string) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["places-autocomplete", query, apiBaseUrl],
    queryFn: () =>
      fetchPlacesAutocomplete(apiBaseUrl, query, sessionToken, { apiKey }),
    staleTime: 10_000,
    enabled: !!apiBaseUrl && query.length >= 2,
  });
}

export function usePlaceDetails(placeId: string | null) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["place-details", placeId, apiBaseUrl],
    queryFn: () => fetchPlaceDetails(apiBaseUrl, placeId!, { apiKey }),
    staleTime: Infinity,
    enabled: !!apiBaseUrl && !!placeId,
  });
}

export function useGeocode(query: string | null) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["geocode", query, apiBaseUrl],
    queryFn: () => fetchGeocode(apiBaseUrl, query!, { apiKey }),
    staleTime: 86_400_000,
    enabled: !!apiBaseUrl && !!query,
  });
}
