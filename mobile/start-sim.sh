#!/bin/bash
# Start the UIUC Bus dev environment with location pinned to UIUC campus.
# Run this instead of "npx expo start --ios" to keep location fixed at UIUC.

# Device selection, in order of preference:
#   1. $1 or $UIUC_SIM_UDID  — explicit override
#   2. an already-booted simulator
#   3. the newest available iPhone
# The previous hardcoded UDID did not exist on any machine, including the
# author's, so ./start-sim.sh failed for everyone.
UDID="${1:-${UIUC_SIM_UDID:-}}"

if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices booted -j \
    | python3 -c 'import json,sys;d=json.load(sys.stdin)["devices"];print(next((x["udid"] for v in d.values() for x in v),""))')
fi

if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices available -j \
    | python3 -c 'import json,sys;d=json.load(sys.stdin)["devices"];c=[x for v in d.values() for x in v if "iPhone" in x["name"]];print(c[-1]["udid"] if c else "")')
fi

if [ -z "$UDID" ]; then
  echo "No iOS simulator found. Install one via Xcode > Settings > Platforms." >&2
  exit 1
fi

echo "Using simulator $UDID"

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
