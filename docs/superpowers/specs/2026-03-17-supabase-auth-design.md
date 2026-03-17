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
├── @supabase/supabase-js — auth client, session in AsyncStorage
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
- New users auto-inserted into `users` table on first authenticated request
- `SUPABASE_JWT_SECRET` empty → 503 (graceful degradation, matches existing pattern)

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

### New file: `backend/src/auth/jwt.py`

```python
import jwt
from fastapi import HTTPException, Request
from settings import get_settings

settings = get_settings()


def _extract_bearer(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authentication token")
    return auth[len("Bearer "):]


def get_current_user(request: Request) -> str:
    """FastAPI dependency. Verifies Supabase JWT and returns user_id (UUID string)."""
    if not settings.supabase_jwt_secret:
        raise HTTPException(status_code=503, detail="Auth not configured")
    token = _extract_bearer(request)
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

### `backend/main.py`

Import and use the dependency on schedule endpoints:
```python
from src.auth.jwt import get_current_user

@app.post("/schedule/classes", ...)
async def post_schedule_class(request: Request, body: CreateClassRequest, user_id: str = Depends(get_current_user)):
    # auto-insert user row if first request
    pool = get_pool()
    await pool.execute("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT DO NOTHING", user_id)
    rec = await create_class(pool, ..., user_id=user_id)
    ...

@app.delete("/schedule/classes/{class_id}", ...)
async def delete_schedule_class(request: Request, class_id: str, user_id: str = Depends(get_current_user)):
    ...
    deleted = await delete_class(pool, class_id, user_id=user_id)
    ...

@app.get("/schedule/classes", ...)
async def get_schedule_classes(request: Request, user_id: str = Depends(get_current_user)):
    ...
    classes = await list_classes(pool, user_id=user_id)
    ...
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

Screen with:
- "Continue with Google" button → `supabase.auth.signInWithOAuth({ provider: "google" })`
- Email input + "Send magic link" button → `supabase.auth.signInWithOtp({ email })`
- Inline error state for failed sign-in attempts
- No password input (magic link covers email path)

### `mobile/app/_layout.tsx`

Add auth gate using `useAuth()`:
```tsx
const { session, loading } = useAuth();
if (loading) return null; // SplashScreen already showing
if (!session) return <Redirect href="/sign-in" />;
// existing stack navigation...
```

Register `sign-in` as a Stack.Screen outside the tab navigator (no header, full screen).

### `mobile/src/api/client.ts`

Add access token injection to all API calls:
```typescript
import { supabase } from "@/src/auth/supabaseClient";

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}
```

Merge auth header into all fetch calls. On 401 response: call `supabase.auth.refreshSession()` and retry once. On second 401: call `supabase.auth.signOut()` (triggers AuthGate redirect).

### `mobile/.env.example`

Add:
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

### `mobile/app/_layout.tsx` — PostHog identity

Swap device ID for real user ID now that auth exists:
```tsx
posthog?.identify(user.id);  // was: posthog?.identify(deviceId)
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

All tests use `unittest.mock.patch("jwt.decode", ...)` — no real Supabase connection needed.

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
4. Copy `SUPABASE_URL`, `SUPABASE_ANON_KEY` → `mobile/.env`
5. Copy `SUPABASE_JWT_SECRET` (Settings → API → JWT Secret) → Railway env vars as `SUPABASE_JWT_SECRET`
6. Add Railway backend URL to Supabase **allowed redirect URLs**

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | mobile/.env | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile/.env | Supabase public anon key |
| `SUPABASE_JWT_SECRET` | Railway dashboard | JWT verification secret |
