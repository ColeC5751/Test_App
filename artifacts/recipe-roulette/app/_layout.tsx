import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/lib/supabase";

WebBrowser.maybeCompleteAuthSession();
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// ─── Auth gate ────────────────────────────────────────────────────────────────
// Watches the Supabase session and redirects accordingly:
//   • No session + not on auth screen → redirect to /auth
//   • Session exists + on auth screen → redirect to /(tabs)
// "Continue without account" sets a local flag to skip the gate.
// This is the ONLY place that should decide navigation based on session
// state — it's path-aware (checks segments) so it never clobbers a user
// who landed on a shared link.

const SKIP_AUTH_KEY = "@recipe_roulette_skip_auth";

function useAuthGate(session: Session | null, sessionLoaded: boolean) {
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!sessionLoaded) return;

    const inAuthGroup = segments[0] === "auth";
    const inSharedGroup = segments[0] === "(shared)";

    // Don't interrupt shared link flows
    if (inSharedGroup) return;

    if (session) {
      // Signed in — push to tabs if on auth screen
      if (inAuthGroup) {
        router.replace("/(tabs)");
      }
    } else {
      // Not signed in — go to auth unless already there
      if (!inAuthGroup) {
        router.replace("/auth");
      }
    }
  }, [session, sessionLoaded, segments]);
}

function RootLayoutNav() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // Load initial session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
  }, []);

  // Listen for auth state changes (magic link callback fires here).
  // NOTE: this only updates local session state — it must NOT navigate.
  // onAuthStateChange fires on initial load too (e.g. INITIAL_SESSION)
  // whenever a session already exists, not just on fresh sign-in. If this
  // listener redirected on every truthy session, it would yank a
  // signed-in user off of any route they landed on directly — including
  // shared plan/grocery links — before that screen ever got to render.
  // useAuthGate above is the single source of truth for navigation
  // because it's path-aware (it checks segments before redirecting).
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Handle deep links — shared grocery/plan links + magic link callback.
  //
  // IMPORTANT (web): this effect fires on every app load, and
  // Linking.getInitialURL() simply returns whatever URL is currently in
  // the address bar — even for a plain, direct page load. On web, Expo
  // Router's file-based routing has ALREADY resolved and mounted the
  // correct screen for that URL by the time this runs (route groups like
  // "(shared)" are invisible in the URL, so "/plan/abc123" already maps
  // straight to app/(shared)/plan/[token].tsx on its own). If we ALSO
  // call router.push() here for the same URL, it mounts a second
  // instance of that screen. For the shared plan/grocery screens, that
  // meant two instances each creating a Supabase realtime channel with
  // the identical name (keyed by row id), and the second subscribe()
  // collided with the first — causing a hard crash:
  //   "cannot add postgres_changes callbacks for realtime:shared_plan_...
  //    after subscribe()"
  //
  // This deep-link matching block exists for native app deep linking
  // (e.g. tapping a link that opens the installed app via a universal
  // link / custom scheme), where there's no browser URL bar already
  // driving navigation — so it's still needed there. On web it's
  // redundant and actively harmful, so we skip it entirely.
  useEffect(() => {
    if (Platform.OS === "web") return;

    const handleUrl = async (url: string) => {
      // Magic link callback
      if (url.includes("auth/callback") || url.includes("access_token") || url.includes("code=")) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(url);
        if (!error && data.session) {
          setSession(data.session);
          router.replace("/(tabs)");
          return;
        }
        // Try setSession from URL directly (implicit flow fallback)
        await supabase.auth.getSession().then(({ data: d }) => {
          if (d.session) { setSession(d.session); router.replace("/(tabs)"); }
        });
        return;
      }

      // Shared grocery/plan links (native only — see comment above)
      const match = url.match(/\/(grocery|plan)\/([a-zA-Z0-9-]+)/);
      if (match) {
        router.push(`/(shared)/${match[1]}/${match[2]}` as any);
      }
    };

    // App already open
    const subscription = Linking.addEventListener("url", ({ url }) => handleUrl(url));

    // App launched via link
    Linking.getInitialURL().then((url) => { if (url) handleUrl(url); });

    return () => subscription.remove();
  }, []);

  useAuthGate(session, sessionLoaded);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="auth" />
      <Stack.Screen name="auth/callback" />
      <Stack.Screen name="(shared)/grocery/[token]" />
      <Stack.Screen name="(shared)/plan/[token]" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
