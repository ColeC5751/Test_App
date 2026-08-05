import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CookModeProps {
  visible: boolean;
  recipeName: string;
  steps: string[];
  onClose: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Progress Bar ─────────────────────────────────────────────────────────────
// Slightly thicker with rounded ends on both the track and fill, and a soft
// glow behind the fill so it reads as an active/"cooking" indicator rather
// than a flat loading bar.

function ProgressBar({
  current,
  total,
  color,
  trackColor,
}: {
  current: number;
  total: number;
  color: string;
  trackColor: string;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: total > 0 ? current / total : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [current, total]);

  const width = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={[styles.progressTrack, { backgroundColor: trackColor }]}>
      <Animated.View
        style={[
          styles.progressFill,
          {
            width,
            backgroundColor: color,
            shadowColor: color,
          },
        ]}
      />
    </View>
  );
}

// ─── CookMode ─────────────────────────────────────────────────────────────────

export function CookMode({ visible, recipeName, steps, onClose }: CookModeProps) {
  const colors = useColors();
  const [currentStep, setCurrentStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  // Drives the step-bubble's little "pop" whenever the step number changes,
  // and the done-state icon's entrance — purely decorative, doesn't touch
  // any of the existing step-transition logic below.
  const bubbleScale = useRef(new Animated.Value(1)).current;

  // Note: screen keep-awake requires expo-keep-awake (~14.0.3) to be added
  // to package.json and pnpm-lock.yaml. Omitted here to avoid lockfile changes.
  // To enable: import * as KeepAwake from "expo-keep-awake" and call
  // KeepAwake.activateKeepAwakeAsync("cook-mode") when visible.

  // Reset to first step whenever the modal opens
  useEffect(() => {
    if (visible) setCurrentStep(0);
  }, [visible]);

  const totalSteps = steps.length;
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;

  const animateTransition = (direction: 1 | -1, callback: () => void) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, {
        toValue: direction * -30,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => {
      callback();
      slideAnim.setValue(direction * 30);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
      // Small pop on the step-number bubble to draw the eye back to "which
      // step am I on" every time it changes — timed to land alongside the
      // fade/slide-in above rather than the fade-out.
      bubbleScale.setValue(0.85);
      Animated.spring(bubbleScale, {
        toValue: 1,
        friction: 5,
        tension: 140,
        useNativeDriver: true,
      }).start();
    });
  };

  const goNext = () => {
    if (isLast) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTransition(1, () => setCurrentStep((s) => s + 1));
  };

  const goPrev = () => {
    if (isFirst) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTransition(-1, () => setCurrentStep((s) => s - 1));
  };

  const handleClose = () => {
    setCurrentStep(0);
    onClose();
  };

  if (!visible || totalSteps === 0) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [
              styles.closeBtn,
              { backgroundColor: colors.card, borderColor: colors.border },
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={12}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.recipeName, { color: colors.foreground }]} numberOfLines={1}>
              {recipeName}
            </Text>
            <View style={[styles.stepPill, { backgroundColor: colors.secondary }]}>
              <Feather name="clock" size={10} color={colors.mutedForeground} />
              <Text style={[styles.stepCount, { color: colors.mutedForeground }]}>
                Step {currentStep + 1} of {totalSteps}
              </Text>
            </View>
          </View>
          {/* Spacer to balance the close button */}
          <View style={styles.closeBtnSpacer} />
        </View>

        {/* Progress bar */}
        <ProgressBar
          current={currentStep + 1}
          total={totalSteps}
          color={colors.primary}
          trackColor={colors.muted}
        />

        {/* Step content */}
        <ScrollView
          style={styles.stepScroll}
          contentContainerStyle={styles.stepScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Step number bubble — ringed + shadowed so it reads as the focal
              point of the screen, with a small pop animation on change. */}
          <Animated.View style={{ transform: [{ scale: bubbleScale }] }}>
            <View
              style={[
                styles.stepBubbleRing,
                { borderColor: colors.secondary },
              ]}
            >
              <View
                style={[
                  styles.stepBubble,
                  { backgroundColor: colors.primary, shadowColor: colors.primary },
                ]}
              >
                <Text style={[styles.stepBubbleText, { color: colors.primaryForeground }]}>
                  {currentStep + 1}
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Step text — currentStep only updates once fadeAnim has reached
               0 (see animateTransition), so the text swap always happens
               while the view is invisible; no remount is needed to avoid
               ghost artifacts. (This used to carry key={currentStep} to force
               a remount, but that remount fired mid-callback of a native-driven
               animation, racing the native animated module. The result: the
               fade-in for the *next* step often failed to attach, so the text
               stayed at opacity 0 for every step after the first.) */}
          <Animated.View
            style={[
              styles.stepTextWrap,
              { opacity: fadeAnim, transform: [{ translateX: slideAnim }] },
            ]}
          >
            <View
              style={[
                styles.stepCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.stepText, { color: colors.foreground }]}>
                {steps[currentStep]}
              </Text>
            </View>
          </Animated.View>

          {/* Done state */}
          {isLast && (
            <Animated.View
              style={[
                styles.doneCard,
                { backgroundColor: colors.secondary, borderColor: colors.primary },
                { opacity: fadeAnim },
              ]}
            >
              <View style={[styles.doneIconRing, { backgroundColor: colors.background, borderColor: colors.primary }]}>
                <Text style={styles.doneEmoji}>🍽️</Text>
              </View>
              <Text style={[styles.doneTitle, { color: colors.foreground }]}>
                That's it!
              </Text>
              <Text style={[styles.doneText, { color: colors.mutedForeground }]}>
                Enjoy your meal.
              </Text>
            </Animated.View>
          )}
        </ScrollView>

        {/* Navigation */}
        <View style={[styles.nav, { borderTopColor: colors.border }]}>
          <Pressable
            onPress={goPrev}
            disabled={isFirst}
            style={({ pressed }) => [
              styles.navBtn,
              styles.navBtnSecondary,
              { backgroundColor: colors.card, borderColor: colors.border },
              isFirst && styles.navBtnDisabled,
              pressed && !isFirst && { opacity: 0.7 },
            ]}
          >
            <Feather
              name="arrow-left"
              size={20}
              color={isFirst ? colors.mutedForeground : colors.foreground}
            />
            <Text
              style={[
                styles.navBtnText,
                { color: isFirst ? colors.mutedForeground : colors.foreground },
              ]}
            >
              Back
            </Text>
          </Pressable>

          {isLast ? (
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => [
                styles.navBtn,
                styles.navBtnPrimary,
                { backgroundColor: colors.primary, shadowColor: colors.primary },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Feather name="check" size={20} color={colors.primaryForeground} />
              <Text style={[styles.navBtnText, { color: colors.primaryForeground }]}>
                Done
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={goNext}
              style={({ pressed }) => [
                styles.navBtn,
                styles.navBtnPrimary,
                { backgroundColor: colors.primary, shadowColor: colors.primary },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={[styles.navBtnText, { color: colors.primaryForeground }]}>
                Next
              </Text>
              <Feather name="arrow-right" size={20} color={colors.primaryForeground} />
            </Pressable>
          )}
        </View>

        {/* Step dots — quick visual overview of position */}
        {totalSteps <= 12 && (
          <View style={styles.dots}>
            {steps.map((_, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  Haptics.selectionAsync();
                  const dir = i > currentStep ? 1 : -1;
                  animateTransition(dir, () => setCurrentStep(i));
                }}
                hitSlop={6}
              >
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        i === currentStep
                          ? colors.primary
                          : i < currentStep
                          ? colors.accent
                          : colors.muted,
                      width: i === currentStep ? 22 : 8,
                    },
                  ]}
                />
              </Pressable>
            ))}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnSpacer: {
    width: 36,
    height: 36,
  },
  recipeName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  stepPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  stepCount: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
  progressTrack: {
    height: 4,
    width: "100%",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    ...Platform.select({
      ios: { shadowOpacity: 0.5, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
      android: {},
      default: {},
    }),
  },
  stepScroll: {
    flex: 1,
  },
  stepScrollContent: {
    padding: 28,
    paddingTop: 40,
    alignItems: "center",
    gap: 28,
    flexGrow: 1,
  },
  stepBubbleRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBubble: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
      default: {},
    }),
  },
  stepBubbleText: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  stepTextWrap: { width: "100%", alignItems: "center" },
  stepCard: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 26,
  },
  stepText: {
    fontSize: 20,
    fontFamily: "Inter_400Regular",
    lineHeight: 32,
    textAlign: "center",
    width: "100%",
  },
  doneCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 28,
    alignItems: "center",
    gap: 8,
    width: "100%",
    marginTop: 12,
  },
  doneIconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  doneEmoji: {
    fontSize: 30,
  },
  doneTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  doneText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  nav: {
    flexDirection: "row",
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
  },
  navBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
  },
  navBtnPrimary: {
    flex: 2,
    ...Platform.select({
      ios: { shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  navBtnSecondary: {
    flex: 1,
    borderWidth: 1,
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingBottom: 20,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});
