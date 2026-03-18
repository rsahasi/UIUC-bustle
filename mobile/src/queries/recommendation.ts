import { useQuery } from "@tanstack/react-query";
import { fetchRecommendation } from "@/src/api/client";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import type { RecommendationRequest } from "@/src/api/types";

export function useRecommendation(
  params: RecommendationRequest | null,
  options?: { enabled?: boolean }
) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    // Spread params object into key so any param change busts the cache.
    // TQ v5 deep-serializes objects in query keys.
    queryKey: params ? ["recommendation", params] : ["recommendation"],
    queryFn: () => fetchRecommendation(apiBaseUrl, params!, { apiKey }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled:
      (options?.enabled ?? true) && !!apiBaseUrl && params !== null,
  });
}
