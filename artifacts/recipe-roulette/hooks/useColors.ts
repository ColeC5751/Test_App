import { Platform, useColorScheme } from "react-native";

import colors from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme.
 * On web, always returns the dark palette to enforce the app's dark theme.
 * On native, follows the device appearance setting (forced dark via app.json).
 */
export function useColors() {
  const systemScheme = useColorScheme();
  // Force dark on web; native is gated by userInterfaceStyle:"dark" in app.json
  const scheme = Platform.OS === "web" ? "dark" : systemScheme;
  const palette =
    scheme === "dark" && "dark" in colors
      ? (colors as Record<string, typeof colors.light>).dark
      : colors.light;
  return { ...palette, radius: colors.radius };
}
