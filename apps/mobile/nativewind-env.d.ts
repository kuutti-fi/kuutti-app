/// <reference types="nativewind/types" />

// The side-effect import of global.css in app/_layout.tsx. Expo declares CSS
// modules in expo-env.d.ts, which `expo start` generates and git ignores, so a
// clean checkout (CI) needs the declaration here.
declare module "*.css";
