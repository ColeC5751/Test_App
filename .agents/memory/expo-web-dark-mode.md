---
name: Expo Web Dark Mode
description: How to force a dark color scheme on web in this Expo/React Native setup without using Appearance.setColorScheme
---

## Rule
Do NOT call `Appearance.setColorScheme("dark")` anywhere (module level or inside useEffect) in this Expo project. It throws `Appearance.default.setColorScheme is not a function` on web and crashes the root layout.

**Why:** The Expo version in this workspace (expo-router 6) doesn't expose `setColorScheme` on the web bundle of `react-native`'s Appearance API.

**How to apply:** Force the dark palette directly in `hooks/useColors.ts`:

```ts
const systemScheme = useColorScheme();
const scheme = Platform.OS === "web" ? "dark" : systemScheme;
```

Native dark mode is handled via `"userInterfaceStyle": "dark"` in `app.json`.
