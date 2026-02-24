#!/bin/bash
# Simulates walking from UIUC center south-east to Pennsylvania Ave Residence Halls
# Each step = ~2 seconds, roughly brisk walking pace (~1.5 m/s)

DEVICE="7AC99C43-52BB-4225-9A99-58D47D94D230"
INTERVAL=2   # seconds between location updates

# Waypoints: lat lon  (center campus → Gregory/Mumford stop → PA Residence Halls)
WAYPOINTS=(
  "40.1042 -88.2279"
  "40.1040 -88.2270"
  "40.1038 -88.2261"
  "40.1036 -88.2252"
  "40.1034 -88.2243"
  "40.1032 -88.2234"
  "40.1030 -88.2225"
  "40.1028 -88.2218"
  "40.1026 -88.2215"
  "40.1024 -88.2212"
  "40.1022 -88.2210"
  "40.1020 -88.2208"
  "40.1018 -88.2206"
  "40.1016 -88.2205"
  "40.1014 -88.2204"
  "40.1012 -88.2204"
  "40.1010 -88.2203"
  "40.1008 -88.2203"
  "40.1006 -88.2203"
  "40.1004 -88.2203"
  "40.1002 -88.2203"
  "40.1000 -88.2203"
  "40.0998 -88.2203"
)

echo "Starting walk simulation (${#WAYPOINTS[@]} points, ${INTERVAL}s interval)"
echo "Press Ctrl+C to stop"

for pt in "${WAYPOINTS[@]}"; do
  lat=$(echo $pt | awk '{print $1}')
  lon=$(echo $pt | awk '{print $2}')
  echo "  → $lat, $lon"
  xcrun simctl location $DEVICE set "$lat,$lon"
  sleep $INTERVAL
done

echo "Arrived!"
