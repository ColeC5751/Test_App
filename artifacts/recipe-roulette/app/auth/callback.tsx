// app/auth/callback.tsx
// Landing page for the magic link redirect.
// Supabase redirects here after the user clicks the email link.
// We exchange the code for a session, then navigate to the tabs.

import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { supabase } from "@/lib/supabase";
import { useColors } from "@/hooks/useColors";

export default function AuthCallbackScreen() {
  const colors = useColors();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // On web, Supabase detects the URL params automatically
        // when detectSessionInUrl: true is set in the client config.
        // We just need to wait for onAuthStateChange to fire in _layout.tsx.
        // But we also try getSession here as a fallback.
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (data.session) {
          router.replace("/(tabs)");
          return;
        }

        // If no session yet, the URL may contain a code — try exchanging it
        if (typeof window !== "undefined") {
          const url = window.location.href;
          if (url.includes("code=")) {
            const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(url);
            if (exchangeError) throw exchangeError;
            router.replace("/(tabs)");
            return;
          }

          // Hash-based token (implicit flow fallback)
          if (url.includes("access_token=")) {
            const { data: refreshed } = await supabase.auth.getSession();
            if (refreshed.session) {
              router.replace("/(tabs)");
              return;
            }
          }
        }

        // Wait a moment and retry — onAuthStateChange in _layout.tsx
        // will handle the redirect if the session comes in async
        setTimeout(async () => {
          const { data: retryData } = await supabase.auth.getSession();
          if (retryData.session) {
            router.replace("/(tabs)");
          } else {
            setError("Sign-in failed. Please try again.");
          }
        }, 2000);

      } catch (err: any) {
        setError(err.message ?? "Sign-in failed. Please try again.");
      }
    };

    handleCallback();
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          <Text
            style={[styles.retryText, { color: colors.primary }]}
            onPress={() => router.replace("/auth")}
          >
            Back to sign in
          </Text>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Signing you in…
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  loadingText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  errorText: { fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  retryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
