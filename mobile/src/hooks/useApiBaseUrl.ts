import { useCallback, useEffect, useState } from "react";
import { getStoredApiBaseUrl, setStoredApiBaseUrl } from "@/src/storage/apiUrl";
import { getStoredApiKey, setStoredApiKey } from "@/src/storage/apiKey";

export function useApiBaseUrl(): {
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => Promise<void>;
  apiKey: string | null;
  setApiKey: (key: string | null) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [apiBaseUrl, setState] = useState<string>("http://localhost:8000");
  const [apiKey, setApiKeyState] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [url, key] = await Promise.all([getStoredApiBaseUrl(), getStoredApiKey()]);
    setState(url);
    setApiKeyState(key);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setApiBaseUrl = useCallback(async (url: string) => {
    await setStoredApiBaseUrl(url);
    setState(url.trim().replace(/\/$/, "") || (await getStoredApiBaseUrl()));
  }, []);

  const setApiKey = useCallback(async (key: string | null) => {
    await setStoredApiKey(key);
    setApiKeyState(key?.trim() || null);
  }, []);

  return { apiBaseUrl, setApiBaseUrl, apiKey, setApiKey, refresh };
}
