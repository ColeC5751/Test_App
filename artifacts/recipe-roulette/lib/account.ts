import { supabase } from "./supabase";

// Client-side companion to supabase/functions/delete-account/index.ts.
//
// FIXED: this originally built the request URL from
// `process.env.EXPO_PUBLIC_SUPABASE_URL`, which doesn't exist in this
// project — supabase.ts hardcodes SUPABASE_URL/SUPABASE_ANON_KEY directly
// instead of reading them from env vars. That made the fetch target
// literally "undefined/functions/v1/delete-account", which on the web
// build resolved as a path on your OWN site (not Supabase at all) — and a
// static host responding to a POST on a route that doesn't exist is
// exactly what produced the 405.
//
// Using supabase.functions.invoke() instead of a manual fetch avoids this
// whole class of bug going forward: it already knows the correct project
// URL from the same `supabase` client instance everything else in the app
// uses, so there's no second place a URL can drift out of sync. It also
// automatically attaches the signed-in user's access token as the
// Authorization header — the Edge Function needs that to verify who's
// asking — so there's no manual session/token plumbing to get wrong either.

export type DeleteAccountResult =
  | { success: true }
  | { success: false; message: string };

export async function deleteAccount(): Promise<DeleteAccountResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return { success: false, message: "You need to be signed in to delete your account." };
    }

    const { data, error } = await supabase.functions.invoke("delete-account", {
      method: "POST",
    });

    if (error) {
      console.error("DELETE ACCOUNT — invoke error:", error);

      // supabase-js wraps a non-2xx response in a FunctionsHttpError whose
      // .context is the raw Response object — the Edge Function's own
      // { error: "..." } JSON body (see index.ts) lives in there, not on
      // `error.message` directly. Try to surface that real message; fall
      // back to something generic if the body isn't readable for any
      // reason (e.g. a network-level failure that never reached the
      // function at all).
      let message = "Couldn't delete your account. Please try again.";
      const context = (error as any)?.context;
      if (context?.json) {
        try {
          const body = await context.json();
          if (body?.error) message = body.error;
        } catch {
          // Response body wasn't JSON / already consumed — keep the
          // generic message rather than throwing here.
        }
      } else if (error.message) {
        message = error.message;
      }

      return { success: false, message };
    }

    // The function returns 200 with { success: true } on the happy path,
    // and — per index.ts — can also return a 500 with { error: "..." }
    // for partial-failure cases (e.g. data deleted but auth user deletion
    // failed). invoke() only treats non-2xx as `error` above, so also
    // check the body shape here in case of any edge case where a 2xx
    // response still carries an error field.
    if (data && (data as any).error) {
      return { success: false, message: (data as any).error };
    }

    return { success: true };
  } catch (error: any) {
    console.error("DELETE ACCOUNT — network/unexpected error:", error);
    return {
      success: false,
      message: error?.message ?? "No connection — check your internet and try again.",
    };
  }
}
