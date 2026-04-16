# Supabase Auth Design

## Goal

Add required authentication to the UIUC Bus App using Supabase Auth (Google OAuth + magic link email). Every user must sign in before accessing the app. Schedule data is scoped to the authenticated user's UUID.

This is Spec 2c of the production-readiness sequence:
1. ✅ Spec 1: Sentry + PostHog
2. ✅ Spec 2a: Railway deployment
3. ✅ Spec 2b: PostgreSQL migration
4. **Spec 2c (this): Supabase Auth**
5. Spec 3: TanStack Query

---

## Architecture

```
Supabase project (auth only — Railway PostgreSQL stays)
└── Google OAuth + email magic link providers
└── SUPABASE_URL + SUPABASE_ANON_KEY → mobile client
└── SUPABASE_JWT_SECRET → backend JWT verification (HS256)

Mobile (Expo)
├── @supabase/supabase-js@^2.49.1 — auth client, session in AsyncStorage (npx expo install @supabase/supabase-js)
├── expo-web-browser@~14.0.2 — in-app browser for Google OAuth (npx expo install expo-web-browser; no app.json plugin needed for v14)
├── expo-linking — deep-link callback (already a transitive dep via expo-router, no install needed)
├── @react-native-async-storage/async-storage — already installed at 1.23.1 in package.json
├── mobile/src/auth/supabaseClient.ts — singleton Supabase client
├── mobile/src/auth/useAuth.ts — { session, user, loading, signOut }
├── mobile/app/sign-in.tsx — Google button + magic link email input
├── mobile/app/_layout.tsx — AuthGate (redirect to /sign-in if no session)
└── mobile/src/api/client.ts — Authorization: Bearer <access_token> on all calls

Backend (FastAPI + Railway PostgreSQL)
├── settings.py — supabase_jwt_secret: str = ""
├── backend/src/auth/jwt.py — get_current_user() FastAPI dependency
├── main.py — schedule endpoints use Depends(get_current_user)
└── alembic/versions/0002_remove_default_user.py — drops "default" seed
```

**Key decisions:**
- Supabase is used for auth only — Railway PostgreSQL is unchanged
- PyJWT with HS256 symmetric verification using `SUPABASE_JWT_SECRET` — no network call per request
- `/recommendation`, `/buildings`, `/stops`, `/vehicles`, `/gtfs` endpoints remain unauthenticated
- Only schedule endpoints (`/schedule/classes`) require auth
- All three schedule endpoints auto-insert the user row (`ON CONFLICT DO NOTHING`) to handle any request ordering
- `SUPABASE_JWT_SECRET` empty → 503 (graceful degradation, matches existing pattern)
- `API_KEY_REQUIRED` must be `false` in Railway (the default) — when `api_key_required=False`, `OptionalAPIKeyMiddleware.dispatch()` calls `call_next(request)` immediately without inspecting the `Authorization` header, so Supabase JWTs pass through unmodified to `get_current_user`. If `API_KEY_REQUIRED=true`, the middleware would try to match the JWT against the static API key set and reject it. Supabase auth replaces that layer for schedule endpoints.

---

## Backend

### `backend/requirements.txt`

Add:
```
PyJWT==2.9.0
```

### `backend/settings.py`

Add:
```python
supabase_jwt_secret: str = ""  # Supabase JWT secret for HS256 token verification
```

### New file: `backend/src/auth/__init__.py`

Empty file — required to make `src.auth` a Python package so `from src.auth.jwt import get_current_user` resolves in `main.py`. Create with: `touch backend/src/auth/__init__.py`.

### New file: `backend/src/auth/jwt.py`

```python
import jwt
from fastapi import Depends, HTTPException, Request
from settings import get_settings


def _extract_bearer(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authentication token")
    return auth[len("Bearer "):]


def get_current_user(request: Request) -> str:
    """FastAPI dependency. Verifies Supabase JWT and returns user_id (UUID string).
    Calls get_settings() each time to support test patching via env vars.
    """
    secret = get_settings().supabase_jwt_secret
    if not secret:
        raise HTTPException(status_code=503, detail="Auth not configured")
    token = _extract_bearer(request)
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

Note: `get_settings()` is called inside the function (not at module level) so tests can patch env vars without stale cached values.

### `backend/main.py`

Import and use the dependency on schedule endpoints. All three endpoints auto-insert the user row first to handle any request ordering (GET before POST, etc.).

Note: `ClassResponse` in `src/schedule/models.py` does not include `user_id` — it is intentionally excluded from the response model to avoid leaking the user identifier to clients.

```python
from src.auth.jwt import get_current_user

@app.post("/schedule/classes", response_model=ClassResponse, status_code=201)
async def post_schedule_class(request: Request, body: CreateClassRequest, user_id: str = Depends(get_current_user)):
    try:
        pool = get_pool()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Database unavailable")
    await pool.execute("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT DO NOTHING", user_id)
    try:
        rec = await create_class(
            pool,
            title=body.title,
            days_of_week=body.days_of_week,
            start_time_local=body.start_time_local,
            building_id=body.building_id,
            destination_lat=body.destination_lat,
            destination_lng=body.destination_lng,
            destination_name=body.destination_name,
            end_time_local=body.end_time_local,
            user_id=user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ClassResponse(
        class_id=rec.class_id,
        title=rec.title,
        days_of_week=rec.days_of_week,
        start_time_local=rec.start_time_local,
        building_id=rec.building_id,
        destination_lat=rec.destination_lat,
        destination_lng=rec.destination_lng,
        destination_name=rec.destination_name,
        end_time_local=rec.end_time_local,
    )

@app.delete("/schedule/classes/{class_id}", status_code=204)
async def delete_schedule_class(request: Request, class_id: str, user_id: str = Depends(get_current_user)):
    try:
        pool = get_pool()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Database unavailable")
    await pool.execute("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT DO NOTHING", user_id)
    deleted = await delete_class(pool, class_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Class not found.")

@app.get("/schedule/classes", response_model=ClassesListResponse)
async def get_schedule_classes(request: Request, user_id: str = Depends(get_current_user)):
    try:
        pool = get_pool()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Database unavailable")
    await pool.execute("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT DO NOTHING", user_id)
    classes = await list_classes(pool, user_id=user_id)
    return ClassesListResponse(
        classes=[
            ClassResponse(
                class_id=c.class_id,
                title=c.title,
                days_of_week=c.days_of_week,
                start_time_local=c.start_time_local,
                building_id=c.building_id,
                destination_lat=c.destination_lat,
                destination_lng=c.destination_lng,
                destination_name=c.destination_name,
                end_time_local=c.end_time_local,
            )
            for c in classes
        ]
    )
```

### `backend/alembic/versions/0002_remove_default_user.py`

```python
"""Remove default user seed

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove orphaned schedule_classes first (FK constraint)
    op.execute("DELETE FROM schedule_classes WHERE user_id = 'default'")
    op.execute("DELETE FROM users WHERE user_id = 'default'")


def downgrade() -> None:
    op.execute("INSERT INTO users (user_id) VALUES ('default') ON CONFLICT DO NOTHING")
```

---

## Mobile

### New file: `mobile/src/auth/supabaseClient.ts`

```typescript
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

### New file: `mobile/src/auth/useAuth.ts`

```typescript
import { useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, user, loading, signOut: () => supabase.auth.signOut() };
}
```

### New file: `mobile/app/sign-in.tsx`

Google OAuth requires `expo-web-browser` (for the in-app browser) and `expo-linking` (for the deep-link callback). The app scheme is already `uiuc-bus` in `app.json` (`"scheme": "uiuc-bus"`).

```tsx
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase } from "@/src/auth/supabaseClient";

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URI = "uiuc-bus://auth/callback";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: REDIRECT_URI },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    if (data.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URI);
      if (result.type === "success" && result.url) {
        // Supabase v2 PKCE flow: exchange the auth code for a session
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(result.url);
        if (exchangeError) setError(exchangeError.message);
        // onAuthStateChange in useAuth.ts will pick up the new session automatically
      }
    }
    setLoading(false);
  }

  async function handleMagicLink() {
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: REDIRECT_URI },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setMagicLinkSent(true);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>UIUC Bustle</Text>
      <Text style={styles.subtitle}>Sign in to track your schedule</Text>

      <TouchableOpacity style={styles.googleButton} onPress={handleGoogleSignIn} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.googleButtonText}>Continue with Google</Text>}
      </TouchableOpacity>

      <Text style={styles.divider}>or</Text>

      <TextInput
        style={styles.input}
        placeholder="Email address"
        placeholderTextColor="#666"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        editable={!loading}
      />
      <TouchableOpacity style={styles.magicButton} onPress={handleMagicLink} disabled={loading}>
        <Text style={styles.magicButtonText}>Send magic link</Text>
      </TouchableOpacity>

      {magicLinkSent && <Text style={styles.successText}>Check your email for a sign-in link.</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#13294B" },
  title: { fontSize: 32, fontFamily: "DMSerifDisplay_400Regular", color: "#fff", marginBottom: 8 },
  subtitle: { fontSize: 16, fontFamily: "DMSans_400Regular", color: "#ccc", marginBottom: 40 },
  googleButton: { width: "100%", backgroundColor: "#E84A27", borderRadius: 8, padding: 14, alignItems: "center", marginBottom: 16 },
  googleButtonText: { color: "#fff", fontFamily: "DMSans_600SemiBold", fontSize: 16 },
  divider: { color: "#aaa", marginBottom: 16 },
  input: { width: "100%", borderWidth: 1, borderColor: "#444", borderRadius: 8, padding: 12, color: "#fff", fontFamily: "DMSans_400Regular", fontSize: 15, marginBottom: 12 },
  magicButton: { width: "100%", borderWidth: 1, borderColor: "#E84A27", borderRadius: 8, padding: 14, alignItems: "center" },
  magicButtonText: { color: "#E84A27", fontFamily: "DMSans_600SemiBold", fontSize: 16 },
  successText: { color: "#4CAF50", marginTop: 16, fontFamily: "DMSans_400Regular" },
  errorText: { color: "#ff6b6b", marginTop: 16, fontFamily: "DMSans_400Regular", textAlign: "center" },
});
```

### `mobile/app/_layout.tsx`

Add auth gate using `useAuth()`. The changes to `RootLayout` are:

**1. Add imports at top of file:**
```tsx
import { Redirect, useSegments } from "expo-router";
import { useAuth } from "@/src/auth/useAuth";
```

**2. Inside `RootLayout`, after the existing `const [fontsLoaded] = useFonts(...)` line, add:**
```tsx
const { session, user, loading: authLoading } = useAuth();
```

**3. Replace the existing `SplashScreen.hideAsync()` effect (lines 102–106 of current `_layout.tsx`) to also wait for `authLoading`:**
```tsx
useEffect(() => {
  if (fontsLoaded && !authLoading) {
    SplashScreen.hideAsync();
  }
}, [fontsLoaded, authLoading]);
```

**4. Replace the existing `if (!fontsLoaded) return null;` guard with an auth redirect. Use `useSegments` to avoid a redirect loop when already on `/sign-in`:**
```tsx
const segments = useSegments();
if (!fontsLoaded || authLoading) {
  return null; // SplashScreen still showing
}
if (!session && segments[0] !== "sign-in") {
  return <Redirect href="/sign-in" />;
}
if (session && segments[0] === "sign-in") {
  return <Redirect href="/" />;
}
// existing PostHogProvider + Stack JSX unchanged...
```

**5. Add `sign-in` as a `Stack.Screen` inside the existing `<Stack>` (no header, full screen):**
```tsx
<Stack.Screen name="sign-in" options={{ headerShown: false }} />
```

### `mobile/src/api/client.ts`

Add the import and make `mergeHeaders` async to inject the Supabase access token:

```typescript
import { supabase } from "@/src/auth/supabaseClient";

async function mergeHeaders(init?: RequestInit, apiKey?: string | null): Promise<Headers> {
  const headers = init?.headers instanceof Headers ? new Headers(init.headers) : new Headers(init?.headers as HeadersInit);
  if (apiKey?.trim()) headers.set("X-API-Key", apiKey.trim());
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return headers;
}
```

Inside `fetchWithRetry`, update lines 54–56 (the declaration block before the retry loop):

```typescript
// Before:
const { signal: userSignal, apiKey, ...rest } = init ?? {};
const headers = mergeHeaders(rest, apiKey);
const requestInit: RequestInit & { signal?: AbortSignal } = { ...rest, headers };
// After:
const { signal: userSignal, apiKey, ...rest } = init ?? {};
const headers = await mergeHeaders(rest, apiKey);
let requestInit: RequestInit & { signal?: AbortSignal } = { ...rest, headers };
```

Note: `rest` includes any `headers: { "Content-Type": "application/json" }` set by callers (e.g. `createClass`). The new `mergeHeaders` does `new Headers(init?.headers as HeadersInit)` which captures those headers, so `Content-Type` is preserved for all existing callers.

Add 401 token-refresh-and-retry logic to `fetchWithRetry`. Declare `let refreshAttempted = false;` immediately before the `for` loop. Insert a 401 check BEFORE the existing `return res` on line 73 (inside the `if (!res.ok)` block, after the retryable backoff check):

```typescript
// Current structure at lines 66-73 (annotated for insertion point):
if (!res.ok) {
  log.warn(...);
  if (attempt < MAX_RETRIES && isRetryable(res.status, null)) {
    // ...backoff + continue
  }
  // INSERT 401 HANDLER HERE, before the final return:
  if (res.status === 401) {
    if (!refreshAttempted) {
      refreshAttempted = true;
      await supabase.auth.refreshSession();
      const refreshedHeaders = await mergeHeaders(rest, apiKey);
      requestInit = { ...requestInit, headers: refreshedHeaders };
      continue;  // retry with refreshed token
    } else {
      await supabase.auth.signOut();  // AuthGate will redirect to /sign-in
      return res;
    }
  }
  return res;  // existing line — unchanged
}
```

### `mobile/.env.example`

Add:
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

### `mobile/app/_layout.tsx` — PostHog identity

Swap device ID for real user ID now that auth exists. The existing `AnalyticsIdentifier` component calls `getOrCreateDeviceId()` and doesn't have access to `user`. Pass `userId` as a prop (obtained from `useAuth()` in `RootLayout`):

```tsx
function AnalyticsIdentifier({ userId }: { userId: string | undefined }) {
  const posthog = usePostHog();
  useEffect(() => {
    if (userId) {
      posthog?.identify(userId);
      if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
        Sentry.setUser({ id: userId });
      }
    }
  }, [posthog, userId]);
  return null;
}

// In RootLayout JSX, pass user.id (user is already extracted from useAuth() above):
<AnalyticsIdentifier userId={user?.id} />
```

---

## Error Handling

| Scenario | Backend | Mobile |
|---|---|---|
| `supabase_jwt_secret` not set | 503 "Auth not configured" | Shows error toast |
| Token expired | 401 "Token expired" | Refresh + retry once, then sign out |
| Invalid/malformed token | 401 "Invalid token" | Sign out → /sign-in |
| Network offline at sign-in | — | Inline error in sign-in screen |
| New user (UUID not in users table) | Auto-insert on first request | Transparent |
| Missing Authorization header | 401 "Missing authentication token" | Sign out → /sign-in |

---

## Testing

**Backend unit tests (`backend/tests/test_auth.py`):**
- Valid JWT → returns user UUID
- Expired JWT → raises HTTPException 401
- Missing `Authorization` header → raises HTTPException 401
- Malformed token → raises HTTPException 401
- Empty `supabase_jwt_secret` → raises HTTPException 503

All tests use `unittest.mock.patch("src.auth.jwt.jwt.decode", ...)` — patch the name as bound in the module under test, not the global `jwt.decode`. No real Supabase connection needed.

Each test must also set `SUPABASE_JWT_SECRET` (e.g. via `monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")`) because `get_current_user()` calls `get_settings().supabase_jwt_secret` and returns 503 before reaching `jwt.decode` if the secret is empty.

**Integration (manual after deploy):**
- Sign in with Google → schedule tab shows empty list
- Add a class → class appears for that user only
- Sign out → redirected to /sign-in
- Sign back in → class still there

---

## Supabase Dashboard Setup

1. Create new Supabase project
2. Enable **Google** OAuth provider (requires Google Cloud OAuth credentials)
3. Enable **Email** provider with "Magic Link" (no passwords)
4. Copy `SUPABASE_URL` as `EXPO_PUBLIC_SUPABASE_URL` and `SUPABASE_ANON_KEY` as `EXPO_PUBLIC_SUPABASE_ANON_KEY` → `mobile/.env`
5. Copy `SUPABASE_JWT_SECRET` (Settings → API → JWT Secret) → Railway env vars as `SUPABASE_JWT_SECRET`
6. Add `uiuc-bus://auth/callback` to Supabase **allowed redirect URLs** (Authentication → URL Configuration → Redirect URLs) — this is the deep-link scheme the mobile app uses for OAuth and magic link callbacks

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | mobile/.env | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile/.env | Supabase public anon key |
| `SUPABASE_JWT_SECRET` | Railway dashboard | JWT verification secret |
