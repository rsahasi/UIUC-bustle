// src/utils/weatherEngine.ts
// Weather engine using Open-Meteo (free, no API key required)

export type WeatherCondition =
  | "CLEAR"
  | "CLOUDY"
  | "DRIZZLE"
  | "RAIN"
  | "HEAVY_RAIN"
  | "SNOW"
  | "STORM"
  | "FOG";

export interface WeatherData {
  tempF: number;
  feelsLikeF: number;
  precipMM: number;
  windMPH: number;
  condition: WeatherCondition;
  precipProbabilityNext2hrs: number; // 0-100
  fetchedAt: number; // epoch ms
}

// Cache entry
interface CacheEntry {
  data: WeatherData;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const weatherCache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

function wmoCodeToCondition(code: number): WeatherCondition {
  if (code === 0 || code === 1) return "CLEAR";
  if (code === 2 || code === 3) return "CLOUDY";
  if (code === 45 || code === 48) return "FOG";
  if (code === 51 || code === 53 || code === 55) return "DRIZZLE";
  if (code === 65 || code === 82) return "HEAVY_RAIN";
  if (code === 61 || code === 63 || code === 80 || code === 81) return "RAIN";
  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return "SNOW";
  if (code === 95 || code === 96 || code === 99) return "STORM";
  // Fallback for any other codes
  return "CLOUDY";
}

export function getWalkMultiplier(weather: WeatherData): number {
  let multiplier = 1.0;

  switch (weather.condition) {
    case "DRIZZLE":
      multiplier = 1.1;
      break;
    case "RAIN":
      multiplier = 1.2;
      break;
    case "HEAVY_RAIN":
      multiplier = 1.3;
      break;
    case "SNOW":
      multiplier = 1.35;
      break;
    case "STORM":
      multiplier = 1.5;
      break;
    case "CLEAR":
    case "CLOUDY":
    case "FOG":
    default:
      multiplier = 1.0;
      break;
  }

  if (weather.windMPH > 20) {
    multiplier *= 1.1;
  }

  if (weather.feelsLikeF < 10) {
    multiplier *= 1.15;
  }

  return multiplier;
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
  const key = cacheKey(lat, lng);
  const cached = weatherCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,precipitation,windspeed_10m,weathercode,apparent_temperature` +
    `&hourly=precipitation_probability` +
    `&forecast_days=1` +
    `&temperature_unit=fahrenheit` +
    `&windspeed_unit=mph`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed: ${response.status}`);
  }

  const json = await response.json();

  const current = json.current ?? {};
  const hourly = json.hourly ?? {};

  const tempF: number = current.temperature_2m ?? 0;
  const feelsLikeF: number = current.apparent_temperature ?? tempF;
  const precipMM: number = current.precipitation ?? 0;
  const windMPH: number = current.windspeed_10m ?? 0;
  const weathercode: number = current.weathercode ?? 0;

  const condition = wmoCodeToCondition(weathercode);

  // Precipitation probability: average of next 2 hours from the hourly array
  const precipProbArray: number[] = hourly.precipitation_probability ?? [];
  let precipProbabilityNext2hrs = 0;
  if (precipProbArray.length >= 2) {
    precipProbabilityNext2hrs = (precipProbArray[0] + precipProbArray[1]) / 2;
  } else if (precipProbArray.length === 1) {
    precipProbabilityNext2hrs = precipProbArray[0];
  }

  const data: WeatherData = {
    tempF,
    feelsLikeF,
    precipMM,
    windMPH,
    condition,
    precipProbabilityNext2hrs,
    fetchedAt: Date.now(),
  };

  weatherCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });

  return data;
}

export async function getWeatherForLocation(lat: number, lng: number): Promise<WeatherData | null> {
  try {
    return await fetchWeather(lat, lng);
  } catch {
    return null;
  }
}

export function getWeatherBanner(weather: WeatherData): string | null {
  switch (weather.condition) {
    case "RAIN":
    case "HEAVY_RAIN":
      return "Raining now — walk times adjusted, bus options ranked higher";
    case "DRIZZLE":
      return "Light drizzle — walk times slightly adjusted";
    case "SNOW":
      return "Snowing — walk times extended, consider the bus";
    case "STORM":
      return "Stormy conditions — all walk times extended";
    case "FOG":
    case "CLEAR":
    case "CLOUDY":
    default:
      return null;
  }
}

export function getWeatherIcon(condition: WeatherCondition): string {
  switch (condition) {
    case "CLEAR":
      return "☀️";
    case "CLOUDY":
      return "☁️";
    case "DRIZZLE":
      return "🌦";
    case "RAIN":
      return "🌧";
    case "HEAVY_RAIN":
      return "⛈";
    case "SNOW":
      return "🌨";
    case "STORM":
      return "⛈";
    case "FOG":
      return "🌫";
    default:
      return "☀️";
  }
}
