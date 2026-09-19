// Sentry's Metro plugin adds debug ids to bundles and source maps so uploaded
// maps match the JavaScript that ran (#11). It wraps Expo's default config.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
