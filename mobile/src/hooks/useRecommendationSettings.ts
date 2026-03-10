import { getMpsForMode } from "@/src/constants/walkingMode";
import type { WalkingModeId } from "@/src/constants/walkingMode";
import {
  DEFAULT_WEIGHT_KG,
  getStoredBufferMinutes,
  getStoredWeightKg,
  getStoredWalkingMode,
  getStoredRainMode,
  setStoredBufferMinutes,
  setStoredWeightKg,
  setStoredWalkingMode,
  setStoredRainMode,
} from "@/src/storage/recommendationSettings";
import { useCallback, useEffect, useState } from "react";

export function useRecommendationSettings(): {
  walkingModeId: WalkingModeId;
  bufferMinutes: number;
  walkingSpeedMps: number;
  weightKg: number;
  rainMode: boolean;
  setWalkingModeId: (id: WalkingModeId) => Promise<void>;
  setBufferMinutes: (minutes: number) => Promise<void>;
  setWeightKg: (kg: number) => Promise<void>;
  setRainMode: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [walkingModeId, setWalkingState] = useState<WalkingModeId>("walk");
  const [bufferMinutes, setBufferState] = useState(5);
  const [weightKg, setWeightState] = useState(DEFAULT_WEIGHT_KG);
  const [rainMode, setRainState] = useState(false);

  const refresh = useCallback(async () => {
    const [mode, buffer, weight, rain] = await Promise.all([
      getStoredWalkingMode(),
      getStoredBufferMinutes(),
      getStoredWeightKg(),
      getStoredRainMode(),
    ]);
    setWalkingState(mode);
    setBufferState(buffer);
    setWeightState(weight);
    setRainState(rain);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setWalkingModeId = useCallback(async (id: WalkingModeId) => {
    await setStoredWalkingMode(id);
    setWalkingState(id);
  }, []);

  const setBufferMinutes = useCallback(async (minutes: number) => {
    const clamped = Math.round(Math.max(0, Math.min(15, minutes)));
    await setStoredBufferMinutes(clamped);
    setBufferState(clamped);
  }, []);

  const setWeightKg = useCallback(async (kg: number) => {
    const clamped = Math.round(Math.max(40, Math.min(150, kg)));
    await setStoredWeightKg(clamped);
    setWeightState(clamped);
  }, []);

  const setRainMode = useCallback(async (enabled: boolean) => {
    await setStoredRainMode(enabled);
    setRainState(enabled);
  }, []);

  const walkingSpeedMps = getMpsForMode(walkingModeId);

  return {
    walkingModeId,
    bufferMinutes,
    walkingSpeedMps,
    weightKg,
    rainMode,
    setWalkingModeId,
    setBufferMinutes,
    setWeightKg,
    setRainMode,
    refresh,
  };
}
