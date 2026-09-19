// NativeWind v4 (#12, TD-9): className is compiled through the nativewind JSX
// runtime. nativewind/babel also adds the Reanimated plugin, which in
// Reanimated 4 forwards to react-native-worklets.
module.exports = (api) => {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
