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
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
