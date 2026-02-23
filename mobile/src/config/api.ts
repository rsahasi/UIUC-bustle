/**
 * API base URL configuration for the UIUC Bus backend.
 *
 * Set EXPO_PUBLIC_API_BASE_URL in .env or .env.local, or it will fall back to the value below.
 *
 * Run targets:
 * - iOS Simulator:    http://localhost:8000  (simulator shares host's loopback)
 * - Android Emulator: http://10.0.2.2:8000    (10.0.2.2 is the host machine from the emulator)
 * - Physical device:  http://<YOUR_COMPUTER_IP>:8000  (e.g. http://192.168.1.100:8000)
 *   Find your IP: macOS/Linux: `ipconfig getifaddr en0` or `hostname -I`; Windows: `ipconfig`
 *
 * Ensure the backend is running and reachable from the device/emulator.
 * For physical devices, ensure phone and computer are on the same Wi‑Fi and firewall allows port 8000.
 */
const getApiBaseUrl = (): string => {
  const env = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (env && env.trim()) return env.replace(/\/$/, "");
  // Default: localhost (suitable for iOS Simulator; change for Android emulator or device)
  return "http://localhost:8000";
};

export const API_BASE_URL = getApiBaseUrl();

export default API_BASE_URL;
