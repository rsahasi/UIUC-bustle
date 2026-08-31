import { useEffect, useState, useSyncExternalStore } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

/**
 * Query keys have to be scoped to the signed-in user, but a query hook opening its own
 * auth subscription would multiply them, so the id lives in a module store that the
 * mounted useAuth feeds.
 */
let currentUserId: string | null = null;
const userIdListeners = new Set<() => void>();

function publishUserId(userId: string | null): void {
  if (currentUserId === userId) return;
  currentUserId = userId;
  for (const listener of userIdListeners) listener();
}

function subscribeUserId(listener: () => void): () => void {
  userIdListeners.add(listener);
  return () => {
    userIdListeners.delete(listener);
  };
}

function getUserIdSnapshot(): string | null {
  return currentUserId;
}

/** Id of the signed-in user, or null. Use to scope anything cached per account. */
export function useCurrentUserId(): string | null {
  return useSyncExternalStore(subscribeUserId, getUserIdSnapshot, getUserIdSnapshot);
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      publishUserId(session?.user?.id ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      publishUserId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, user, loading, signOut: () => supabase.auth.signOut() };
}
