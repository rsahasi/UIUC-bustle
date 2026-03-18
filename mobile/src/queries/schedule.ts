import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createClass,
  deleteClass,
  updateClass,
  fetchBuildingSearch,
  fetchBuildings,
  fetchClasses,
} from "@/src/api/client";
import type { UpdateClassRequest } from "@/src/api/types";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";

export function useClasses() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["classes"],
    queryFn: () => fetchClasses(apiBaseUrl, { apiKey }),
    staleTime: 60_000,
    enabled: !!apiBaseUrl,
  });
}

export function useBuildings() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["buildings"],
    queryFn: () => fetchBuildings(apiBaseUrl, { apiKey }),
    staleTime: Infinity,
    enabled: !!apiBaseUrl,
  });
}

export function useBuildingSearch(query: string) {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  return useQuery({
    queryKey: ["building-search", query],
    queryFn: () => fetchBuildingSearch(apiBaseUrl, query, { apiKey }),
    staleTime: 30_000,
    enabled: !!apiBaseUrl && query.length >= 2,
  });
}

export function useCreateClass() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof createClass>[1]) =>
      createClass(apiBaseUrl, body, { apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
    },
  });
}

export function useDeleteClass() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (classId: string) =>
      deleteClass(apiBaseUrl, classId, { apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
    },
  });
}

export function useUpdateClass() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, updates }: { classId: string; updates: UpdateClassRequest }) =>
      updateClass(apiBaseUrl, classId, updates, { apiKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
    },
  });
}
