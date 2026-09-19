// Sentry's Metro plugin adds debug ids to bundles and source maps so uploaded
// maps match the JavaScript that ran (#11). It wraps Expo's default config;
// NativeWind (#12) wraps that to compile global.css with Tailwind.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require("nativewind/metro");

module.exports = withNativeWind(getSentryExpoConfig(__dirname), { input: "./global.css" });
