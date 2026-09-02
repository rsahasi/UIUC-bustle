import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getStoredApiBaseUrl, setStoredApiBaseUrl } from "@/src/storage/apiUrl";
import { getStoredApiKey, setStoredApiKey } from "@/src/storage/apiKey";

interface ApiConfig {
  apiBaseUrl: string;
  apiKey: string | null;
}

/**
 * One store for the whole app: per-component state let a dozen copies disagree while
 * each of them independently read storage. The base URL starts empty rather than at the
 * compiled-in default so callers gating on it do not fire against the wrong host and
 * cache the answer before the stored value arrives.
 */
let config: ApiConfig = { apiBaseUrl: "", apiKey: null };
const listeners = new Set<() => void>();
let loaded: Promise<void> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ApiConfig {
  return config;
}

async function loadConfig(): Promise<void> {
  const [url, key] = await Promise.all([getStoredApiBaseUrl(), getStoredApiKey()]);
  config = { apiBaseUrl: url, apiKey: key };
  emit();
}

export function useApiBaseUrl(): {
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => Promise<void>;
  apiKey: string | null;
  setApiKey: (key: string | null) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const { apiBaseUrl, apiKey } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(async () => {
    loaded = loadConfig();
    await loaded;
  }, []);

  useEffect(() => {
    if (!loaded) loaded = loadConfig();
  }, []);

  const setApiBaseUrl = useCallback(async (url: string) => {
    await setStoredApiBaseUrl(url);
    const next = url.trim().replace(/\/$/, "") || (await getStoredApiBaseUrl());
    config = { ...config, apiBaseUrl: next };
    emit();
  }, []);

  const setApiKey = useCallback(async (key: string | null) => {
    await setStoredApiKey(key);
    config = { ...config, apiKey: key?.trim() || null };
    emit();
  }, []);

  return { apiBaseUrl, setApiBaseUrl, apiKey, setApiKey, refresh };
}
