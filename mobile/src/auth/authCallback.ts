import { supabase } from "./supabaseClient";

let lastHandledCode: string | null = null;

/**
 * Complete a PKCE auth flow from a redirect URL (OAuth or magic link).
 *
 * exchangeCodeForSession expects the bare auth code, not the full URL.
 * Both the openAuthSessionAsync result (sign-in screen) and the deep-link
 * listener (root layout) can fire for the same redirect, and the second
 * exchange would always fail because the first consumes the stored code
 * verifier — so repeated codes are ignored.
 *
 * Returns an error message, or null on success / no-op.
 */
export async function completeAuthFromUrl(url: string): Promise<string | null> {
  const match = url.match(/[?&#]code=([^&#]+)/);
  if (!match) return null; // not an auth callback URL
  const code = decodeURIComponent(match[1]);
  if (code === lastHandledCode) return null; // duplicate delivery of same redirect
  lastHandledCode = code;
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return error ? error.message : null;
}
