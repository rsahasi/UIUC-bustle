import { useQuery } from "@tanstack/react-query";
import { fetchRecommendation } from "@/src/api/client";
import { useCurrentUserId } from "@/src/auth/useAuth";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import type { RecommendationRequest } from "@/src/api/types";

export function useRecommendation(
  params: RecommendationRequest | null,
  options?: { enabled?: boolean }
) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const userId = useCurrentUserId();
  return useQuery({
    // Spread params object into key so any param change busts the cache.
    // TQ v5 deep-serializes objects in query keys. The userId scopes the entry to the
    // signed-in account, since params carry that user's saved destination coordinates.
    queryKey: params
      ? ["recommendation", params, userId, apiBaseUrl]
      : ["recommendation", null, userId, apiBaseUrl],
    queryFn: () => fetchRecommendation(apiBaseUrl, params!, { apiKey }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled:
      (options?.enabled ?? true) && !!apiBaseUrl && params !== null,
  });
}
