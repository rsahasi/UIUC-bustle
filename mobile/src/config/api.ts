/**
 * API base URL configuration for the UIUC Bus backend.
 *
 * Set EXPO_PUBLIC_API_BASE_URL in your EAS build profile (eas.json) or .env.local.
 *
 * Run targets:
 * - iOS Simulator:    http://localhost:8000  (simulator shares host's loopback)
 * - Android Emulator: http://10.0.2.2:8000    (10.0.2.2 is the host machine from the emulator)
 * - Physical device:  http://<YOUR_COMPUTER_IP>:8000
 * - Production:       Set EXPO_PUBLIC_API_BASE_URL in eas.json production profile
 */
const getApiBaseUrl = (): string => {
  const env = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (env && env.trim()) return env.replace(/\/$/, "");
  if (__DEV__) return "http://localhost:8000";
  // Production build without env var set — will fail loudly so the misconfiguration is obvious
  console.error(
    "[UIUC Bustle] EXPO_PUBLIC_API_BASE_URL is not set. " +
    "Set it in your eas.json production build profile."
  );
  return "http://localhost:8000";
};

export const API_BASE_URL = getApiBaseUrl();

export default API_BASE_URL;
