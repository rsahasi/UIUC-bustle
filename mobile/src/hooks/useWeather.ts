// src/hooks/useWeather.ts
// Simple hook that fetches current weather for the user's location (or UIUC fallback)

import { useEffect, useState } from "react";
import * as Location from "expo-location";
import { getWeatherForLocation, WeatherData } from "@/src/utils/weatherEngine";

const UIUC = { lat: 40.102, lng: -88.2272 };

export function useWeather(): WeatherData | null {
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    (async () => {
      let lat = UIUC.lat;
      let lng = UIUC.lng;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        }
      } catch {
        // fall through to UIUC fallback
      }
      const w = await getWeatherForLocation(lat, lng);
      setWeather(w);
    })();
  }, []);

  return weather;
}

export default useWeather;
