#!/bin/bash
# Simulates walking from Siebel Center south along Wright St to a bus stop
# then riding the ILLINI bus south to PAR
# Usage: bash simulate_walk.sh

DEVICE="booted"

echo "📍 Starting at Siebel Center..."
move() {
  xcrun simctl location "$DEVICE" set "$1,$2"
  sleep "$3"
}

# Phase 1: Walking south on Wright St (~1.4 m/s)
move 40.11380 -88.22490 2
move 40.11362 -88.22495 2
move 40.11344 -88.22500 2
move 40.11326 -88.22505 2
move 40.11308 -88.22510 2
move 40.11290 -88.22515 2
move 40.11272 -88.22520 2
move 40.11254 -88.22525 2
move 40.11236 -88.22530 2
move 40.11218 -88.22535 2
move 40.11200 -88.22540 2
move 40.11182 -88.22545 2
move 40.11164 -88.22550 2
move 40.11146 -88.22555 2
move 40.11128 -88.22560 2

echo "🚏 Arriving at bus stop (Wright & Green)..."
move 40.11110 -88.22565 2
move 40.11095 -88.22568 2
move 40.11090 -88.22570 3
move 40.11090 -88.22570 3
move 40.11090 -88.22570 3

echo "🚌 Boarding ILLINI bus — heading south..."
# Phase 2: Bus speed (~8 m/s)
move 40.11040 -88.22580 1
move 40.10980 -88.22590 1
move 40.10920 -88.22600 1
move 40.10860 -88.22605 1
move 40.10800 -88.22610 1
move 40.10740 -88.22612 1
move 40.10680 -88.22614 1
move 40.10620 -88.22615 1
move 40.10560 -88.22615 1
move 40.10500 -88.22614 1
move 40.10440 -88.22612 1
move 40.10380 -88.22610 1
move 40.10320 -88.22580 1
move 40.10260 -88.22540 1
move 40.10200 -88.22500 1
move 40.10150 -88.22440 1
move 40.10110 -88.22380 1
move 40.10070 -88.22300 1
move 40.10040 -88.22220 1

echo "🏁 Arriving at PAR stop..."
move 40.10020 -88.21950 1
move 40.09995 -88.21920 2
move 40.09990 -88.21920 3
move 40.09990 -88.21920 3

echo "✅ Simulation complete."
