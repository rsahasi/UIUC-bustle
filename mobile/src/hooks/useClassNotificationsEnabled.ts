import {
  getClassNotificationsEnabled,
  setClassNotificationsEnabled,
} from "@/src/storage/classNotifications";
import { useCallback, useEffect, useState } from "react";

export function useClassNotificationsEnabled(): {
  enabled: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [enabled, setState] = useState(false);

  const refresh = useCallback(async () => {
    const v = await getClassNotificationsEnabled();
    setState(v);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setEnabled = useCallback(async (value: boolean) => {
    await setClassNotificationsEnabled(value);
    setState(value);
  }, []);

  return { enabled, setEnabled, refresh };
}
