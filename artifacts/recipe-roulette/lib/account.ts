import { supabase } from "./supabase";

// Client-side companion to supabase/functions/delete-account/index.ts.
// Deliberately thin — all the real logic (verifying identity, deleting
// rows, deleting the auth user) lives server-side in the Edge Function,
// since it requires the service role key that must never ship in the app.
// This just: gets the current session's access token, calls the function
// with it, and translates the response into something the UI can show.

export type DeleteAccountResult =
  | { success: true }
  | { success: false; message: string };

export async function deleteAccount(): Promise<DeleteAccountResult> {
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session) {
      return { success: false, message: "You need to be signed in to delete your account." };
    }

    // EXPO_PUBLIC_SUPABASE_URL is the same project URL the app already
    // uses for supabase.ts's client — Edge Functions live at
    // {project_url}/functions/v1/{function_name}.
    const functionsUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`;

    const res = await fetch(functionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const message =
        data?.error ?? `Couldn't delete your account (status ${res.status}). Please try again.`;
      console.error("DELETE ACCOUNT — client received failure:", data);
      return { success: false, message };
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
