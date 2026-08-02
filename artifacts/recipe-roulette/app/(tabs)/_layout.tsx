import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useSessionStatus } from "@/hooks/useSessionStatus";

// Per-tab active tint. Keeps each icon visually distinct when selected
// instead of every tab sharing one accent color. Inactive state still
// falls back to the theme's colors.mutedForeground, and the bar itself
// (background/blur/border) is untouched.
const TAB_TINTS = {
  index: "#FF9F4A", // Spin — orange
  roulette: "#4ADE80", // My Dinners — green
  grocery: "#38BDF8", // Grocery List — blue
  plan: "#F472B6", // Plan — pink
  shared: "#C084FC", // Shared — purple
} as const;

function NativeTabLayout({ sharedLocked }: { sharedLocked: boolean }) {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "shuffle", selected: "shuffle" }} />
        <Label>Spin</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="roulette">
        <Icon sf={{ default: "fork.knife", selected: "fork.knife" }} />
        <Label>My Dinners</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="grocery">
        <Icon sf={{ default: "cart", selected: "cart.fill" }} />
        <Label>Grocery List</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plan">
        <Icon sf={{ default: "calendar", selected: "calendar" }} />
        <Label>Plan</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="shared">
        {/* NativeTabs doesn't support arbitrary badge overlays on the icon,
            so when locked we swap to a lock glyph entirely as the clearest
            signal available within its API. Tapping still lands on
            shared.tsx, which redirects to /auth via useRequireSession. */}
        <Icon sf={{ default: sharedLocked ? "lock" : "person.2", selected: sharedLocked ? "lock.fill" : "person.2.fill" }} />
        <Label>{sharedLocked ? "Shared 🔒" : "Shared"}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout({ sharedLocked }: { sharedLocked: boolean }) {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.card },
              ]}
            />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Spin",
          tabBarActiveTintColor: TAB_TINTS.index,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="shuffle" tintColor={color} size={24} />
            ) : (
              <Feather name="shuffle" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="roulette"
        options={{
          title: "My Dinners",
          tabBarActiveTintColor: TAB_TINTS.roulette,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="fork.knife" tintColor={color} size={24} />
            ) : (
              <Feather name="book-open" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="grocery"
        options={{
          title: "Grocery List",
          tabBarActiveTintColor: TAB_TINTS.grocery,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="cart" tintColor={color} size={24} />
            ) : (
              <Feather name="shopping-cart" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: "Plan",
          tabBarActiveTintColor: TAB_TINTS.plan,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="calendar" tintColor={color} size={24} />
            ) : (
              <Feather name="calendar" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="shared"
        options={{
          title: sharedLocked ? "Shared 🔒" : "Shared",
          tabBarActiveTintColor: TAB_TINTS.shared,
          tabBarIcon: ({ color }) => (
            <View>
              {isIOS ? (
                <SymbolView name="person.2" tintColor={color} size={24} />
              ) : (
                <Feather name="users" size={22} color={color} />
              )}
              {sharedLocked && (
                <View style={[styles.lockBadge, { backgroundColor: colors.card, borderColor: colors.background }]}>
                  <Feather name="lock" size={9} color={colors.mutedForeground} />
                </View>
              )}
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { locked } = useSessionStatus();

  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout sharedLocked={locked} />;
  }
  return <ClassicTabLayout sharedLocked={locked} />;
}

const styles = StyleSheet.create({
  lockBadge: {
    position: "absolute",
    right: -6,
    bottom: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});
