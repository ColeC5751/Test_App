import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";

// Lightweight, dependency-free "saved" celebration: a handful of colored
// dots burst outward and fade while a checkmark pill pops in and out.
// No external confetti library needed — just Animated + a few Views.

const CONFETTI_COLORS = ["#FF6B2B", "#7C8C5E", "#C8A86B", "#B87333", "#6B8E6B", "#E8B4B8"];
const PARTICLE_COUNT = 14;

type Particle = {
  angle: number;
  distance: number;
  size: number;
  color: string;
  delay: number;
};

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    return {
      angle,
      distance: 50 + Math.random() * 40,
      size: 5 + Math.random() * 5,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 80,
    };
  });
}

export interface SavedToastProps {
  visible: boolean;
  label?: string;
}

export function SavedToast({ visible, label = "Saved!" }: SavedToastProps) {
  const colors = useColors();
  const particlesRef = useRef<Particle[]>(makeParticles());
  const progress = useRef(new Animated.Value(0)).current;
  const pillScale = useRef(new Animated.Value(0)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    particlesRef.current = makeParticles();
    progress.setValue(0);
    pillScale.setValue(0.6);
    pillOpacity.setValue(0);

    Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.parallel([
          Animated.spring(pillScale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
          Animated.timing(pillOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        ]),
        Animated.delay(700),
        Animated.parallel([
          Animated.timing(pillScale, { toValue: 0.8, duration: 200, useNativeDriver: true }),
          Animated.timing(pillOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
      ]),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.center}>
        {/* Confetti particles */}
        {particlesRef.current.map((p, i) => {
          const tx = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, Math.cos(p.angle) * p.distance],
          });
          const ty = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, Math.sin(p.angle) * p.distance],
          });
          const opacity = progress.interpolate({
            inputRange: [0, 0.15, 1],
            outputRange: [0, 1, 0],
          });
          const scale = progress.interpolate({
            inputRange: [0, 0.2, 1],
            outputRange: [0.4, 1, 0.6],
          });
          return (
            <Animated.View
              key={i}
              style={[
                styles.particle,
                {
                  width: p.size,
                  height: p.size,
                  borderRadius: p.size / 2,
                  backgroundColor: p.color,
                  opacity,
                  transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                },
              ]}
            />
          );
        })}

        {/* Pill */}
        <Animated.View
          style={[
            styles.pill,
            {
              backgroundColor: colors.primary,
              opacity: pillOpacity,
              transform: [{ scale: pillScale }],
            },
          ]}
        >
          <Feather name="check" size={16} color={colors.primaryForeground} />
          <Text style={[styles.pillText, { color: colors.primaryForeground }]}>{label}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  particle: {
    position: "absolute",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 50,
    paddingHorizontal: 18,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  pillText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
});
