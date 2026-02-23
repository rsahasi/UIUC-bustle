#!/bin/bash
# Start the UIUC Bus dev environment with location pinned to UIUC campus.
# Run this instead of "npx expo start --ios" to keep location fixed at UIUC.

UDID="7AC99C43-52BB-4225-9A99-58D47D94D230"
UIUC_LAT="40.1094"
UIUC_LNG="-88.2273"

# Boot simulator if not already running
if ! xcrun simctl list devices | grep -q "($UDID) (Booted)"; then
  echo "Booting simulator..."
  xcrun simctl boot "$UDID" 2>/dev/null || true
  open -a Simulator
  sleep 3
fi

# Use 'start' (not 'set') so the location scenario keeps running after relaunches.
# Two nearly-identical points 0.1m apart at 0.001 m/s → loops ~every 100s, effectively static.
echo "Pinning location to UIUC Illini Union ($UIUC_LAT, $UIUC_LNG)..."
xcrun simctl location "$UDID" start \
  --speed=0.001 \
  --interval=60 \
  "${UIUC_LAT},${UIUC_LNG}" \
  "${UIUC_LAT}001,${UIUC_LNG}001"

echo "Location pinned. Starting Expo..."
cd "$(dirname "$0")" && npx expo start --ios
