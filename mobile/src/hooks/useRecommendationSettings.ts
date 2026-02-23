import { getMpsForMode } from "@/src/constants/walkingMode";
import type { WalkingModeId } from "@/src/constants/walkingMode";
import {
  getStoredBufferMinutes,
  getStoredWalkingMode,
  setStoredBufferMinutes,
  setStoredWalkingMode,
} from "@/src/storage/recommendationSettings";
import { useCallback, useEffect, useState } from "react";

export function useRecommendationSettings(): {
  walkingModeId: WalkingModeId;
  bufferMinutes: number;
  walkingSpeedMps: number;
  setWalkingModeId: (id: WalkingModeId) => Promise<void>;
  setBufferMinutes: (minutes: number) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [walkingModeId, setWalkingState] = useState<WalkingModeId>("walk");
  const [bufferMinutes, setBufferState] = useState(5);

  const refresh = useCallback(async () => {
    const [mode, buffer] = await Promise.all([
      getStoredWalkingMode(),
      getStoredBufferMinutes(),
    ]);
    setWalkingState(mode);
    setBufferState(buffer);
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

  const walkingSpeedMps = getMpsForMode(walkingModeId);

  return {
    walkingModeId,
    bufferMinutes,
    walkingSpeedMps,
    setWalkingModeId,
    setBufferMinutes,
    refresh,
  };
}
