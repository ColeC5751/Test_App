import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
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
      <Animated.View style={[styles.progressFill, { width, backgroundColor: color }]} />
    </View>
  );
}

// ─── CookMode ─────────────────────────────────────────────────────────────────

export function CookMode({ visible, recipeName, steps, onClose }: CookModeProps) {
  const colors = useColors();
  const [currentStep, setCurrentStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

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
          <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={12}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.recipeName, { color: colors.foreground }]} numberOfLines={1}>
              {recipeName}
            </Text>
            <Text style={[styles.stepCount, { color: colors.mutedForeground }]}>
              Step {currentStep + 1} of {totalSteps}
            </Text>
          </View>
          {/* Spacer to balance the close button */}
          <View style={styles.closeBtn} />
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
          {/* Step number bubble */}
          <View style={[styles.stepBubble, { backgroundColor: colors.primary }]}>
            <Text style={[styles.stepBubbleText, { color: colors.primaryForeground }]}>
              {currentStep + 1}
            </Text>
          </View>

          {/* Step text */}
          <Animated.Text
            style={[
              styles.stepText,
              { color: colors.foreground },
              { opacity: fadeAnim, transform: [{ translateX: slideAnim }] },
            ]}
          >
            {steps[currentStep]}
          </Animated.Text>

          {/* Done state */}
          {isLast && (
            <Animated.View
              style={[
                styles.doneCard,
                { backgroundColor: colors.secondary, borderColor: colors.primary },
                { opacity: fadeAnim },
              ]}
            >
              <Text style={styles.doneEmoji}>🍽️</Text>
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
                { backgroundColor: colors.primary },
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
                { backgroundColor: colors.primary },
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
                      width: i === currentStep ? 20 : 8,
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
    gap: 2,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  recipeName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  stepCount: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  progressTrack: {
    height: 3,
    width: "100%",
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
  },
  stepScroll: {
    flex: 1,
  },
  stepScrollContent: {
    padding: 28,
    paddingTop: 36,
    alignItems: "center",
    gap: 24,
    flexGrow: 1,
  },
  stepBubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBubbleText: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  stepText: {
    fontSize: 20,
    fontFamily: "Inter_400Regular",
    lineHeight: 32,
    textAlign: "center",
    width: "100%",
  },
  doneCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 24,
    alignItems: "center",
    gap: 8,
    width: "100%",
    marginTop: 16,
  },
  doneEmoji: {
    fontSize: 40,
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
