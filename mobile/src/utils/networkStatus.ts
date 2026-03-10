import { useEffect, useState } from 'react';

export async function isOnline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://www.google.com', { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export function useNetworkStatus(): { online: boolean } {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const check = async () => setOnline(await isOnline());
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);
  return { online };
}
