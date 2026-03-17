module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  transformIgnorePatterns: [
    "node_modules/(?!((uuid|@react-native-async-storage|expo-secure-store)/)?)",
  ],
};
