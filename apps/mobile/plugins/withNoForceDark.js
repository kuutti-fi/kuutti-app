const { AndroidConfig, withAndroidStyles } = require("expo/config-plugins");

/**
 * MIUI's "dark mode for third-party apps" repaints an app that has not opted
 * out: the light theme inverted, the light-blue primary darkened, high
 * contrast broken (seen on a Redmi on 2026-09-20, #27). The app follows the
 * system scheme itself and ships its own dark and high-contrast token sets, so
 * it declares the standard opt-out on its theme.
 */
module.exports = function withNoForceDark(config) {
  return withAndroidStyles(config, (mod) => {
    mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: "android:forceDarkAllowed",
      value: "false",
    });
    return mod;
  });
};
