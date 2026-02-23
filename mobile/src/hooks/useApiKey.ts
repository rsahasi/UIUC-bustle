import { useCallback, useEffect, useState } from "react";
import { getStoredApiKey, setStoredApiKey } from "@/src/storage/apiKey";

export function useApiKey(): {
  apiKey: string | null;
  setApiKey: (key: string | null) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [apiKey, setState] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const key = await getStoredApiKey();
    setState(key);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setApiKey = useCallback(async (key: string | null) => {
    await setStoredApiKey(key);
    setState(key?.trim() || null);
  }, []);

  return { apiKey, setApiKey, refresh };
}
