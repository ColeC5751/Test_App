import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { OnboardingCopy } from "@/lib/onboarding";

// Persistent, unobtrusive banner shown while onboarding is active. Meant to
// sit at the top of any tab (see _layout.tsx) so a user who navigates away
// mid-flow is gently pointed back rather than blocked outright — full
// navigation locks were considered and rejected: they risk frustrating a
// user who already knows what they want on their very first session, and
// there's no requirement to force it this hard.
//
// `onReturnHome` is only relevant when the current tab ISN'T the one the
// active step lives on (e.g. user wandered to Grocery while still on the
// "spin" step) — pass it to deep-link back. Omit it when the banner is
// rendered on the correct screen already.

export function OnboardingBanner({
  copy,
  onSkip,
  onReturnHome,
  showReturnAction,
}: {
  copy: OnboardingCopy;
  onSkip: () => void;
  onReturnHome?: () => void;
  showReturnAction?: boolean;
}) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });

  return (
    <View style={[styles.root, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Animated.View style={[styles.dot, { backgroundColor: colors.primary, opacity: dotOpacity, transform: [{ scale: dotScale }] }]} />
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{copy.bannerTitle}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{copy.bannerSubtitle}</Text>
      </View>

      {showReturnAction && onReturnHome && (
        <Pressable onPress={onReturnHome} hitSlop={8} style={styles.action}>
          <Text style={[styles.actionText, { color: colors.primary }]}>Go</Text>
          <Feather name="arrow-right" size={14} color={colors.primary} />
        </Pressable>
      )}

      <Pressable onPress={onSkip} hitSlop={8} style={styles.skipBtn}>
        <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Skip</Text>
      </Pressable>
    </View>
  );
}

// Small pulsing ring used to draw the eye to a specific button (e.g. the
// SPIN button or the bookmark icon) while its onboarding step is active.
// Wrap the target element in this rather than modifying the element itself,
// so it's a no-op visually once onboarding completes.
export function OnboardingPulseRing({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(400),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  if (!active) return <>{children}</>;

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <View style={styles.ringWrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          { borderColor: colors.primary, opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 20,
    marginBottom: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  textWrap: { flex: 1, gap: 1 },
  title: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 11, fontFamily: "Inter_400Regular" },
  action: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 },
  actionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  skipBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  skipText: { fontSize: 12, fontFamily: "Inter_400Regular", textDecorationLine: "underline" },
  // alignItems/justifyContent intentionally omitted (defaults to "stretch")
  // — this wrapper sits around the full-width SPIN button. Centering here
  // would shrink that button down to its text content instead of letting
  // it fill the row like it normally does, which is what made it look
  // wrong. The ring itself is absolutely positioned and inset from the
  // wrapper's own bounds, so it still traces the button's real shape
  // regardless of this wrapper's alignment.
  ringWrap: { position: "relative", width: "100%" },
  ring: {
    position: "absolute",
    top: -6, left: -6, right: -6, bottom: -6,
    borderWidth: 2,
    borderRadius: 999,
  },
});
