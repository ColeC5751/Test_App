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
import { SkipAuthProvider, useSkipAuth } from "@/contexts/SkipAuthContext";
import { supabase } from "@/lib/supabase";

WebBrowser.maybeCompleteAuthSession();
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// ─── Auth gate ────────────────────────────────────────────────────────────────
// Watches the Supabase session (and the shared "skip auth" context — see
// contexts/SkipAuthContext.tsx) and redirects accordingly:
//   • No session + no skip flag + not on auth screen → redirect to /auth
//   • Real session + on auth screen                  → redirect to /(tabs)
//   • Skip flag, no real session                      → no forced redirect
//     either direction. This lets a skip-auth user freely visit /auth
//     later (e.g. to sign in for real) without being bounced straight back
//     to /(tabs) by this gate. Individual screens that require a real
//     account (see Shared tab) enforce that themselves via
//     useRequireSession, not here.
// skipAuth comes from context (not local state) specifically so that
// tapping "Continue without account" in app/auth.tsx updates this gate's
// view of the world on the very next render — no stale value, no bounce.
// This is the ONLY place that should decide navigation based on session
// state — it's path-aware (checks segments) so it never clobbers a user
// who landed on a shared link.

function useAuthGate(
  session: Session | null,
  sessionLoaded: boolean,
  skipAuth: boolean,
  skipAuthLoaded: boolean
) {
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    // Wait for BOTH sources before making any navigation decision — acting
    // on session state while skipAuth is still mid-load (or vice versa)
    // is exactly the kind of stale-read race that caused the original bug.
    if (!sessionLoaded || !skipAuthLoaded) return;

    const inAuthGroup = segments[0] === "auth";
    const inSharedGroup = segments[0] === "(shared)";

    // Don't interrupt shared link flows
    if (inSharedGroup) return;

    if (session) {
      // Real session — never let a signed-in user sit on the auth screen
      if (inAuthGroup) {
        router.replace("/(tabs)");
      }
    } else if (skipAuth) {
      // Skipped auth, no real session — free to browse tabs, and free to
      // navigate to /auth on their own without being forced back out.
      // No redirect fires in this branch, either direction.
    } else {
      // Never skipped, no session — always push to auth
      if (!inAuthGroup) {
        router.replace("/auth");
      }
    }
  }, [session, sessionLoaded, skipAuth, skipAuthLoaded, segments]);
}

function RootLayoutNav() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const { skipAuth, skipAuthLoaded, setSkipAuth } = useSkipAuth();

  // Load initial session.
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
  //
  // On a real sign-in we also clear the skip-auth flag via context, so a
  // user who previously tapped "continue without account" and later signs
  // in properly doesn't leave a stale flag sitting around.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === "SIGNED_IN" && newSession) {
        setSkipAuth(false).catch((err) => console.error("Failed to clear skip-auth flag:", err));
      }
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

  useAuthGate(session, sessionLoaded, skipAuth, skipAuthLoaded);

  // Transition tuning per screen. Kept subtle and purposeful rather than
  // decorative: auth fades in/out (a calm, low-motion moment rather than
  // a "navigating somewhere" moment), while shared links slide in from
  // the right (reads as drilling into content, matching the mental model
  // of "opening a plan/list"). Native only — `animation` is a no-op on
  // web, where Expo Router relies on browser navigation instead.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
      <Stack.Screen name="auth" options={{ animation: "fade", animationDuration: 220 }} />
      <Stack.Screen name="auth/callback" options={{ animation: "fade" }} />
      <Stack.Screen
        name="(shared)/grocery/[token]"
        options={{ animation: "slide_from_right", animationDuration: 260 }}
      />
      <Stack.Screen
        name="(shared)/plan/[token]"
        options={{ animation: "slide_from_right", animationDuration: 260 }}
      />
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
              <SkipAuthProvider>
                <RootLayoutNav />
              </SkipAuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
