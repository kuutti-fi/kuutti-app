const { SourceSkips } = require("@expo/fingerprint");

// The `extra` section carries the git commit of the JavaScript (app.config.ts).
// It is not native: a new commit must not read as a new runtime version, or
// every push would spend a build and orphan every installed one (rules/mobile.md).
module.exports = { sourceSkips: SourceSkips.ExpoConfigExtraSection };
