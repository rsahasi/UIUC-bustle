import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { fetchCrowding, submitCrowdingReport } from "@/src/api/client";
import { getCrowdingToken } from "@/src/storage/crowdingToken";
import type { CrowdingReportRequest } from "@/src/api/types";

export function useCrowding(vehicleId: string | null, routeId?: string) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["crowding", vehicleId],
    queryFn: () =>
      vehicleId ? fetchCrowding(apiBaseUrl, vehicleId, routeId, { apiKey: apiKey ?? undefined }) : null,
    enabled: !!vehicleId && !!apiBaseUrl,
    staleTime: 25_000,
    refetchInterval: 30_000,
  });
}

export function useSubmitCrowding() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: CrowdingReportRequest) => {
      const token = await getCrowdingToken();
      return submitCrowdingReport(apiBaseUrl, { ...req, user_token: token }, { apiKey: apiKey ?? undefined });
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["crowding", vars.vehicle_id] });
    },
  });
}
