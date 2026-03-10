const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// On web, stub out native-only modules that don't have web implementations
const nativeOnlyModules = [
  "react-native-maps",
  "expo-sensors",
  "expo-notifications",
  "expo-location",
  "@react-native-community/slider",
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web") {
    const isNativeOnly = nativeOnlyModules.some(
      (mod) => moduleName === mod || moduleName.startsWith(mod + "/")
    );
    if (isNativeOnly) {
      return {
        type: "sourceFile",
        filePath: path.resolve(__dirname, "web-stubs/native-stub.js"),
      };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
