// Web stub for native-only modules
// Screens using these modules guard with Platform.OS checks or render gracefully.

const React = require("react");
const { View, Text } = require("react-native");

// ── MapView (react-native-maps) ──────────────────────────────────────────────
const MapStub = (props) =>
  React.createElement(
    View,
    { style: [{ backgroundColor: "#f4f5f7", borderRadius: 8, alignItems: "center", justifyContent: "center", minHeight: 200 }, props.style] },
    React.createElement(Text, { style: { color: "#9ca3af", fontSize: 13 } }, "Map not available on web")
  );
MapStub.displayName = "MapView";
module.exports = MapStub;
module.exports.default = MapStub;
module.exports.Marker = () => null;
module.exports.Polyline = () => null;
module.exports.Circle = () => null;
module.exports.Callout = () => null;
module.exports.PROVIDER_GOOGLE = "google";
module.exports.PROVIDER_DEFAULT = null;

// ── expo-sensors ─────────────────────────────────────────────────────────────
module.exports.Pedometer = {
  isAvailableAsync: async () => false,
  watchStepCount: () => ({ remove: () => {} }),
};

// ── expo-notifications ───────────────────────────────────────────────────────
module.exports.getLastNotificationResponseAsync = async () => null;
module.exports.addNotificationResponseReceivedListener = () => ({ remove: () => {} });
module.exports.addNotificationReceivedListener = () => ({ remove: () => {} });
module.exports.requestPermissionsAsync = async () => ({ status: "denied" });
module.exports.getPermissionsAsync = async () => ({ status: "denied" });
module.exports.scheduleNotificationAsync = async () => null;
module.exports.cancelAllScheduledNotificationsAsync = async () => {};
module.exports.cancelScheduledNotificationAsync = async () => {};
module.exports.getAllScheduledNotificationsAsync = async () => [];
module.exports.setNotificationHandler = () => {};
module.exports.useLastNotificationResponse = () => null;
module.exports.AndroidImportance = { HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 };
module.exports.setNotificationChannelAsync = async () => null;

// ── expo-location ────────────────────────────────────────────────────────────
module.exports.requestForegroundPermissionsAsync = async () => ({ status: "denied" });
module.exports.getCurrentPositionAsync = async () => ({ coords: { latitude: 40.102, longitude: -88.2272 } });
module.exports.watchPositionAsync = async () => ({ remove: () => {} });
module.exports.Accuracy = { Balanced: 3, High: 4, Highest: 5, Low: 2, Lowest: 1, BestForNavigation: 6 };

// ── @react-native-community/slider ───────────────────────────────────────────
const SliderStub = (props) =>
  React.createElement("input", {
    type: "range",
    min: props.minimumValue ?? 0,
    max: props.maximumValue ?? 1,
    step: props.step ?? 0.01,
    value: props.value ?? 0,
    style: { width: "100%", accentColor: "#E84A27" },
    onChange: (e) => {
      const v = parseFloat(e.target.value);
      props.onValueChange?.(v);
      props.onSlidingComplete?.(v);
    },
  });
module.exports.Slider = SliderStub;
module.exports.default = SliderStub; // some imports use default
