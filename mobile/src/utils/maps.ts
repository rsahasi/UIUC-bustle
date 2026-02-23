import { Linking, Platform } from "react-native";

/**
 * Open native maps with walking directions from current location to destination.
 */
export function openWalkingDirections(lat: number, lng: number): void {
  const url =
    Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
  Linking.openURL(url);
}
