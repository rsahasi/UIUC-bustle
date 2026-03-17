# Supabase Auth Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add required Supabase Auth (Google OAuth + magic link email) to the UIUC Bus App — every user must sign in, schedule data is scoped to their UUID.

**Architecture:** Supabase is used for auth only — Railway PostgreSQL stays. PyJWT with HS256 symmetric verification (`SUPABASE_JWT_SECRET`) guards the three schedule endpoints with no network call per request. The mobile client stores the session in AsyncStorage and injects `Authorization: Bearer <access_token>` on every API call.

**Tech Stack:** PyJWT==2.9.0 (backend), @supabase/supabase-js@^2.49.1 + expo-web-browser@~14.0.2 (mobile), Alembic (schema migration), pytest + monkeypatch (backend tests)

**Spec:** `docs/superpowers/specs/2026-03-17-supabase-auth-design.md`

---

## Chunk 1: Backend

### Task 1: requirements.txt + settings.py

**Files:**
- Modify: `backend/requirements.txt:1-12`
- Modify: `backend/settings.py:1-36`

- [ ] **Step 1: Add PyJWT to requirements.txt**

  Open `backend/requirements.txt` and add after the last line:
  ```
  PyJWT==2.9.0
  ```
  Final file should have `PyJWT==2.9.0` as the last line (line 13).

- [ ] **Step 2: Add supabase_jwt_secret to settings.py**

  In `backend/settings.py`, add after the `google_places_api_key` field (line 29):
  ```python
  # Supabase Auth — set SUPABASE_JWT_SECRET in Railway env vars (Settings → API → JWT Secret)
  supabase_jwt_secret: str = ""
  ```
  The relevant block at the end of the `Settings` class (lines 29–36 after this change) should be:
  ```python
      google_places_api_key: str = ""

      # Supabase Auth — set SUPABASE_JWT_SECRET in Railway env vars (Settings → API → JWT Secret)
      supabase_jwt_secret: str = ""

      # Sentry error monitoring — set SENTRY_DSN in .env to enable
      sentry_dsn: str = ""


  def get_settings() -> Settings:
      return Settings()
  ```

- [ ] **Step 3: Verify settings loads without error**

  Run from `backend/`:
  ```bash
  cd /Users/25ruhans/UIUC_APP/backend && .venv/bin/python3 -c "from settings import get_settings; s = get_settings(); print(s.supabase_jwt_secret)"
  ```
  Expected: prints empty string `""`

- [ ] **Step 4: Commit**

  ```bash
  git add backend/requirements.txt backend/settings.py
  git commit -m "feat: add PyJWT dependency and supabase_jwt_secret setting"
  ```

---

### Task 2: Backend auth module — jwt.py (TDD)

**Files:**
- Create: `backend/src/auth/__init__.py`
- Create: `backend/src/auth/jwt.py`
- Create: `backend/tests/test_auth.py`

- [ ] **Step 1: Create the `src/auth/` package**

  ```bash
  touch /Users/25ruhans/UIUC_APP/backend/src/auth/__init__.py
  ```

- [ ] **Step 2: Install PyJWT into the venv (before writing tests — tests import `jwt`)**

  ```bash
  cd /Users/25ruhans/UIUC_APP/backend && .venv/bin/pip install PyJWT==2.9.0 --quiet
  ```

- [ ] **Step 3: Write the failing tests**

  Create `backend/tests/test_auth.py`:
  ```python
  """Unit tests for src.auth.jwt — no real Supabase connection needed."""
  import pytest
  from unittest.mock import patch
  from fastapi import HTTPException
  from starlette.testclient import TestClient
  from starlette.requests import Request
  from starlette.datastructures import Headers


  def _make_request(authorization: str = "") -> Request:
      """Build a minimal Starlette Request with the given Authorization header."""
      scope = {
          "type": "http",
          "method": "GET",
          "path": "/",
          "headers": [(b"authorization", authorization.encode())] if authorization else [],
          "query_string": b"",
      }
      return Request(scope)


  class TestGetCurrentUser:
      def test_missing_secret_raises_503(self, monkeypatch):
          monkeypatch.setenv("SUPABASE_JWT_SECRET", "")
          from src.auth.jwt import get_current_user
          import importlib, src.auth.jwt
          importlib.reload(src.auth.jwt)
          from src.auth.jwt import get_current_user
          req = _make_request("Bearer sometoken")
          with pytest.raises(HTTPException) as exc:
              get_current_user(req)
          assert exc.value.status_code == 503
          assert "Auth not configured" in exc.value.detail

      def test_missing_authorization_header_raises_401(self, monkeypatch):
          monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
          from src.auth import jwt as jwt_module
          import importlib; importlib.reload(jwt_module)
          req = _make_request()  # no Authorization header
          with pytest.raises(HTTPException) as exc:
              jwt_module.get_current_user(req)
          assert exc.value.status_code == 401
          assert "Missing authentication token" in exc.value.detail

      def test_valid_token_returns_user_id(self, monkeypatch):
          monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
          # Reload BEFORE patching — reload inside the patch context manager would un-patch.
          from src.auth import jwt as jwt_module
          import importlib; importlib.reload(jwt_module)
          with patch("src.auth.jwt.jwt.decode") as mock_decode:
              mock_decode.return_value = {"sub": "user-uuid-123"}
              req = _make_request("Bearer validtoken")
              result = jwt_module.get_current_user(req)
          assert result == "user-uuid-123"

      def test_expired_token_raises_401(self, monkeypatch):
          import jwt as pyjwt
          monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
          from src.auth import jwt as jwt_module
          import importlib; importlib.reload(jwt_module)
          with patch("src.auth.jwt.jwt.decode") as mock_decode:
              mock_decode.side_effect = pyjwt.ExpiredSignatureError("expired")
              req = _make_request("Bearer expiredtoken")
              with pytest.raises(HTTPException) as exc:
                  jwt_module.get_current_user(req)
          assert exc.value.status_code == 401
          assert "Token expired" in exc.value.detail

      def test_invalid_token_raises_401(self, monkeypatch):
          import jwt as pyjwt
          monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
          from src.auth import jwt as jwt_module
          import importlib; importlib.reload(jwt_module)
          with patch("src.auth.jwt.jwt.decode") as mock_decode:
              mock_decode.side_effect = pyjwt.InvalidTokenError("bad token")
              req = _make_request("Bearer badtoken")
              with pytest.raises(HTTPException) as exc:
                  jwt_module.get_current_user(req)
          assert exc.value.status_code == 401
          assert "Invalid token" in exc.value.detail
  ```

- [ ] **Step 4: Run tests — verify they all FAIL**

  ```bash
  cd /Users/25ruhans/UIUC_APP/backend && .venv/bin/python3 -m pytest tests/test_auth.py -v 2>&1 | head -40
  ```
  Expected: all 5 tests fail with `ModuleNotFoundError: No module named 'src.auth.jwt'`

- [ ] **Step 5: Create `backend/src/auth/jwt.py`**

  ```python
  import jwt
  from fastapi import HTTPException, Request
  from settings import get_settings


  def _extract_bearer(request: Request) -> str:
      auth = request.headers.get("Authorization", "")
      if not auth.startswith("Bearer "):
          raise HTTPException(status_code=401, detail="Missing authentication token")
      return auth[len("Bearer "):]


  def get_current_user(request: Request) -> str:
      """FastAPI dependency. Verifies Supabase JWT and returns user_id (UUID string).
      get_settings() is called inside the function (not at module level) so tests can
      patch env vars without stale cached values.
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

- [ ] **Step 6: Run tests — verify all 5 PASS**

  ```bash
  cd /Users/25ruhans/UIUC_APP/backend && .venv/bin/python3 -m pytest tests/test_auth.py -v
  ```
  Expected:
  ```
  tests/test_auth.py::TestGetCurrentUser::test_missing_secret_raises_503 PASSED
  tests/test_auth.py::TestGetCurrentUser::test_missing_authorization_header_raises_401 PASSED
  tests/test_auth.py::TestGetCurrentUser::test_valid_token_returns_user_id PASSED
  tests/test_auth.py::TestGetCurrentUser::test_expired_token_raises_401 PASSED
  tests/test_auth.py::TestGetCurrentUser::test_invalid_token_raises_401 PASSED
  5 passed
  ```

- [ ] **Step 7: Run full backend test suite — verify no regressions**


  ```bash
  cd /Users/25ruhans/UIUC_APP/backend && .venv/bin/python3 -m pytest --tb=short -q 2>&1 | tail -10
  ```
  Expected: all existing tests still pass

- [ ] **Step 8: Commit**

  ```bash
  git add backend/src/auth/__init__.py backend/src/auth/jwt.py backend/tests/test_auth.py
  git commit -m "feat: add backend JWT auth module with unit tests"
  ```

---

### Task 3: Alembic migration 0002 — remove default user

**Files:**
- Create: `backend/alembic/versions/0002_remove_default_user.py`

- [ ] **Step 1: Create the migration file**

  Create `backend/alembic/versions/0002_remove_default_user.py`:
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

- [ ] **Step 2: Verify Alembic can parse the migration (no syntax errors)**

  ```bash
  cd /Users/25ruhans/UIUC_APP/backend && python3 -c "
  import importlib.util
  spec = importlib.util.spec_from_file_location('m', 'alembic/versions/0002_remove_default_user.py')
  m = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(m)
  print('revision:', m.revision, '  down_revision:', m.down_revision)
  "
  ```
  Expected: `revision: 0002   down_revision: 0001`

- [ ] **Step 3: Commit**

  ```bash
  git add backend/alembic/versions/0002_remove_default_user.py
  git commit -m "feat: alembic migration 0002 — remove default user seed"
  ```

---

### Task 4: main.py — add auth to schedule endpoints

**Files:**
- Modify: `backend/main.py:8,17,565-634`

The three schedule endpoints currently use `user_id="default"`. This task adds `Depends(get_current_user)` to each, auto-inserts the user row before each operation, and passes the real `user_id`.

- [ ] **Step 1: Update imports**

  In `backend/main.py`, **replace** line 8 (`from fastapi import FastAPI, HTTPException, Request`) with:
  ```python
  from fastapi import Depends, FastAPI, HTTPException, Request
  ```

  Then add a new line after the `from src.data.stops_repo import search_nearby` import (currently line 21):
  ```python
  from src.auth.jwt import get_current_user
  ```

- [ ] **Step 2: Replace `post_schedule_class` (lines 565–596)**

  Replace the entire function:
  ```python
  @app.post("/schedule/classes", response_model=ClassResponse, status_code=201)
  async def post_schedule_class(request: Request, body: CreateClassRequest, user_id: str = Depends(get_current_user)):
      """Create a class for the authenticated user."""
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
  ```

- [ ] **Step 3: Replace `delete_schedule_class` (lines 599–608)**

  Replace the entire function:
  ```python
  @app.delete("/schedule/classes/{class_id}", status_code=204)
  async def delete_schedule_class(request: Request, class_id: str, user_id: str = Depends(get_current_user)):
      """Delete a class belonging to the authenticated user."""
      try:
          pool = get_pool()
      except RuntimeError:
          raise HTTPException(status_code=503, detail="Database unavailable")
      await pool.execute("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT DO NOTHING", user_id)
      deleted = await delete_class(pool, class_id, user_id=user_id)
      if not deleted:
          raise HTTPException(status_code=404, detail="Class not found.")
  ```

- [ ] **Step 4: Replace `get_schedule_classes` (lines 611–634)**

  Replace the entire function:
  ```python
  @app.get("/schedule/classes", response_model=ClassesListResponse)
  async def get_schedule_classes(request: Request, user_id: str = Depends(get_current_user)):
      """List classes for the authenticated user."""
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

- [ ] **Step 5: Verify main.py imports cleanly**

  ```bash
  cd /Users/25ruhans/UIUC_APP/backend && .venv/bin/python3 -c "import main; print('OK')"
  ```
  Expected: `OK`

- [ ] **Step 6: Run full backend test suite — verify no regressions**

  ```bash
  cd /Users/25ruhans/UIUC_APP/backend && .venv/bin/python3 -m pytest --tb=short -q 2>&1 | tail -10
  ```
  Expected: all tests pass (schedule endpoint tests that used `user_id="default"` will now require auth, so they should still pass or be updated if they call those endpoints directly — if any fail, check if they need a mock `get_current_user` override).

- [ ] **Step 7: Commit**

  ```bash
  git add backend/main.py
  git commit -m "feat: add JWT auth dependency to schedule endpoints"
  ```

---

## Chunk 2: Mobile

### Task 5: Install packages + supabaseClient.ts

**Files:**
- Create: `mobile/src/auth/supabaseClient.ts`
- Modify: `mobile/package.json` (via npm install)

- [ ] **Step 1: Install new packages**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx expo install @supabase/supabase-js expo-web-browser
  ```
  Expected: packages added to `package.json` and installed in `node_modules`.

- [ ] **Step 2: Create `mobile/src/auth/` directory**

  ```bash
  mkdir -p /Users/25ruhans/UIUC_APP/mobile/src/auth
  ```

- [ ] **Step 3: Create `mobile/src/auth/supabaseClient.ts`**

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

- [ ] **Step 4: Verify TypeScript compilation**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | head -20
  ```
  Expected: no errors related to `supabaseClient.ts`

- [ ] **Step 5: Commit**

  ```bash
  git add mobile/src/auth/supabaseClient.ts mobile/package.json mobile/package-lock.json
  git commit -m "feat: add Supabase client singleton"
  ```

---

### Task 6: useAuth.ts hook

**Files:**
- Create: `mobile/src/auth/useAuth.ts`

- [ ] **Step 1: Create `mobile/src/auth/useAuth.ts`**

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

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      });

      return () => subscription.unsubscribe();
    }, []);

    return { session, user, loading, signOut: () => supabase.auth.signOut() };
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | head -20
  ```
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add mobile/src/auth/useAuth.ts
  git commit -m "feat: add useAuth hook for Supabase session management"
  ```

---

### Task 7: sign-in.tsx screen

**Files:**
- Create: `mobile/app/sign-in.tsx`

- [ ] **Step 1: Create `mobile/app/sign-in.tsx`**

  ```tsx
  import { useState } from "react";
  import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
  } from "react-native";
  import * as WebBrowser from "expo-web-browser";
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
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            result.url
          );
          if (exchangeError) setError(exchangeError.message);
          // onAuthStateChange in useAuth will pick up the new session automatically
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

        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleSignIn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          )}
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
        <TouchableOpacity
          style={styles.magicButton}
          onPress={handleMagicLink}
          disabled={loading}
        >
          <Text style={styles.magicButtonText}>Send magic link</Text>
        </TouchableOpacity>

        {magicLinkSent && (
          <Text style={styles.successText}>Check your email for a sign-in link.</Text>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      backgroundColor: "#13294B",
    },
    title: {
      fontSize: 32,
      fontFamily: "DMSerifDisplay_400Regular",
      color: "#fff",
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      fontFamily: "DMSans_400Regular",
      color: "#ccc",
      marginBottom: 40,
    },
    googleButton: {
      width: "100%",
      backgroundColor: "#E84A27",
      borderRadius: 8,
      padding: 14,
      alignItems: "center",
      marginBottom: 16,
    },
    googleButtonText: {
      color: "#fff",
      fontFamily: "DMSans_600SemiBold",
      fontSize: 16,
    },
    divider: { color: "#aaa", marginBottom: 16 },
    input: {
      width: "100%",
      borderWidth: 1,
      borderColor: "#444",
      borderRadius: 8,
      padding: 12,
      color: "#fff",
      fontFamily: "DMSans_400Regular",
      fontSize: 15,
      marginBottom: 12,
    },
    magicButton: {
      width: "100%",
      borderWidth: 1,
      borderColor: "#E84A27",
      borderRadius: 8,
      padding: 14,
      alignItems: "center",
    },
    magicButtonText: {
      color: "#E84A27",
      fontFamily: "DMSans_600SemiBold",
      fontSize: 16,
    },
    successText: {
      color: "#4CAF50",
      marginTop: 16,
      fontFamily: "DMSans_400Regular",
    },
    errorText: {
      color: "#ff6b6b",
      marginTop: 16,
      fontFamily: "DMSans_400Regular",
      textAlign: "center",
    },
  });
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | head -20
  ```
  Expected: no errors related to `sign-in.tsx`

- [ ] **Step 3: Commit**

  ```bash
  git add mobile/app/sign-in.tsx
  git commit -m "feat: add sign-in screen (Google OAuth + magic link)"
  ```

---

### Task 8: _layout.tsx — auth gate + AnalyticsIdentifier update

**Files:**
- Modify: `mobile/app/_layout.tsx:1-138`

The current `_layout.tsx` (138 lines) needs four changes:
1. New imports (`Redirect`, `useSegments`, `useAuth`)
2. `useAuth()` call inside `RootLayout` after `useFonts`
3. `SplashScreen.hideAsync()` effect extended to wait for `!authLoading`
4. Auth redirect guards replacing the `if (!fontsLoaded) return null` guard
5. `sign-in` Stack.Screen added inside `<Stack>`
6. `AnalyticsIdentifier` updated to use real user ID

- [ ] **Step 1: Add imports**

  In `mobile/app/_layout.tsx`, update the import block. Replace:
  ```typescript
  import { Stack } from "expo-router";
  ```
  With:
  ```typescript
  import { Redirect, Stack, useSegments } from "expo-router";
  import { useAuth } from "@/src/auth/useAuth";
  ```
  Also remove the `getOrCreateDeviceId` import (line 23) since `AnalyticsIdentifier` will no longer need it:
  ```typescript
  // Remove this line:
  import { getOrCreateDeviceId } from "@/src/utils/deviceId";
  ```

- [ ] **Step 2: Update `AnalyticsIdentifier` component (lines 68–81)**

  Replace the entire `AnalyticsIdentifier` function:
  ```tsx
  /** Identifies the user in both Sentry and PostHog once auth is established. */
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
  ```

- [ ] **Step 3: Update `RootLayout` — add `useAuth()` and `useSegments()` calls**

  Inside `RootLayout`, after the existing `const [fontsLoaded] = useFonts({...})` block (after line 90), add both hooks. They must be declared at the top of the component — before any `useEffect` calls and before any conditional returns — to satisfy React's Rules of Hooks:
  ```tsx
  const { session, user, loading: authLoading } = useAuth();
  const segments = useSegments();
  ```

- [ ] **Step 4: Replace the `SplashScreen.hideAsync()` effect**

  Replace the existing effect at lines 102–106:
  ```tsx
  // Old:
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);
  ```
  With:
  ```tsx
  useEffect(() => {
    if (fontsLoaded && !authLoading) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, authLoading]);
  ```

- [ ] **Step 5: Replace the early return guard and add auth redirects**

  Replace lines 108–110:
  ```tsx
  // Old:
  if (!fontsLoaded) {
    return null;
  }
  ```
  With:
  ```tsx
  if (!fontsLoaded || authLoading) {
    return null; // SplashScreen still showing
  }
  if (!session && segments[0] !== "sign-in") {
    return <Redirect href="/sign-in" />;
  }
  if (session && segments[0] === "sign-in") {
    return <Redirect href="/" />;
  }
  ```
  Note: `segments` is already declared in Step 3 — do not redeclare it here.

- [ ] **Step 6: Add `sign-in` Stack.Screen and pass userId to AnalyticsIdentifier**

  Inside the `<Stack>` JSX, add after `<Stack.Screen name="(tabs)" />`:
  ```tsx
  <Stack.Screen name="sign-in" options={{ headerShown: false }} />
  ```

  Update `<AnalyticsIdentifier />` to pass `userId`:
  ```tsx
  <AnalyticsIdentifier userId={user?.id} />
  ```

- [ ] **Step 7: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors

- [ ] **Step 8: Commit**

  ```bash
  git add mobile/app/_layout.tsx
  git commit -m "feat: add auth gate and PostHog user identity to _layout"
  ```

---

### Task 9: client.ts — async mergeHeaders + 401 retry

**Files:**
- Modify: `mobile/src/api/client.ts:1,27-94`

- [ ] **Step 1: Add Supabase import at top of `client.ts`**

  After the existing `import { log }` line (line 1), add:
  ```typescript
  import { supabase } from "@/src/auth/supabaseClient";
  ```

- [ ] **Step 2: Replace `mergeHeaders` (lines 27–31)**

  Replace the function:
  ```typescript
  // Old (sync):
  function mergeHeaders(init?: RequestInit, apiKey?: string | null): RequestInit["headers"] {
    const headers = init?.headers instanceof Headers ? new Headers(init.headers) : new Headers(init?.headers as HeadersInit);
    if (apiKey?.trim()) headers.set("X-API-Key", apiKey.trim());
    return headers;
  }
  ```
  With:
  ```typescript
  // New (async — injects Supabase access token):
  async function mergeHeaders(init?: RequestInit, apiKey?: string | null): Promise<Headers> {
    const headers = init?.headers instanceof Headers ? new Headers(init.headers) : new Headers(init?.headers as HeadersInit);
    if (apiKey?.trim()) headers.set("X-API-Key", apiKey.trim());
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
    return headers;
  }
  ```

- [ ] **Step 3: Update `fetchWithRetry` — lines 54–56 and 58**

  Replace lines 54–58 (the destructure + `requestInit` declaration + loop start):
  ```typescript
  // Old:
  const { signal: userSignal, apiKey, ...rest } = init ?? {};
  const headers = mergeHeaders(rest, apiKey);
  const requestInit: RequestInit & { signal?: AbortSignal } = { ...rest, headers };
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  ```
  With:
  ```typescript
  const { signal: userSignal, apiKey, ...rest } = init ?? {};
  const headers = await mergeHeaders(rest, apiKey);
  let requestInit: RequestInit & { signal?: AbortSignal } = { ...rest, headers };
  let lastError: unknown;
  let refreshAttempted = false;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  ```

- [ ] **Step 4: Add 401 retry handler inside `fetchWithRetry`**

  Inside the `if (!res.ok)` block (currently lines 66–73), add the 401 handler BEFORE the final `return res`. The block should become:
  ```typescript
  if (!res.ok) {
    log.warn(`api_response path=${pathLabel} status=${res.status}`, { path: pathLabel, status: res.status });
    if (attempt < MAX_RETRIES && isRetryable(res.status, null)) {
      const backoff = Math.min(RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 300, RETRY_MAX_MS);
      await delay(backoff);
      continue;
    }
    if (res.status === 401) {
      if (!refreshAttempted) {
        refreshAttempted = true;
        await supabase.auth.refreshSession();
        const refreshedHeaders = await mergeHeaders(rest, apiKey);
        requestInit = { ...requestInit, headers: refreshedHeaders };
        continue; // retry with refreshed token
      } else {
        // Second 401 after refresh — session is truly invalid, sign out
        await supabase.auth.signOut(); // AuthGate in _layout.tsx will redirect to /sign-in
        return res;
      }
    }
    return res;
  }
  ```

  **Important:** The `continue` in the 401 handler re-runs the loop body with `attempt` incremented. The `refreshAttempted` flag ensures the refresh happens exactly once — on the second 401 (after a failed refresh), the `else` branch calls `signOut()` and returns immediately without further retries.

- [ ] **Step 5: Verify TypeScript compiles**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1 | head -20
  ```
  Expected: no errors

- [ ] **Step 6: Commit**

  ```bash
  git add mobile/src/api/client.ts
  git commit -m "feat: inject Supabase Bearer token in API client with 401 refresh retry"
  ```

---

### Task 10: .env.example + final polish

**Files:**
- Modify: `mobile/.env.example`

- [ ] **Step 1: Add Supabase env vars to `.env.example`**

  Open `mobile/.env.example` and add at the end:
  ```
  # Supabase Auth — get from your Supabase project dashboard (Settings → API)
  EXPO_PUBLIC_SUPABASE_URL=
  EXPO_PUBLIC_SUPABASE_ANON_KEY=
  ```

- [ ] **Step 2: Verify TypeScript compiles clean (full check)**

  ```bash
  cd /Users/25ruhans/UIUC_APP/mobile && npx tsc --noEmit 2>&1
  ```
  Expected: no output (zero errors)

- [ ] **Step 3: Run full backend tests one final time**

  ```bash
  cd /Users/25ruhans/UIUC_APP/backend && .venv/bin/python3 -m pytest --tb=short -q
  ```
  Expected: all tests pass

- [ ] **Step 4: Commit**

  ```bash
  git add mobile/.env.example
  git commit -m "docs: add Supabase env vars to .env.example"
  ```

---

## Manual Integration Checklist (after Supabase dashboard is configured)

After setting up the Supabase project (see spec §Supabase Dashboard Setup):

1. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `mobile/.env`
2. Set `SUPABASE_JWT_SECRET` in Railway dashboard env vars
3. Start the app: `cd mobile && npx expo start --ios`
4. Verify: app shows sign-in screen (not the tabs)
5. Sign in with Google → schedule tab shows empty list
6. Add a class → class appears
7. Sign out → redirected to sign-in
8. Sign back in → class still there
9. Verify different Google accounts see different schedule data
