from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "UIUC Bus API"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8000
    # CORS: empty string disallows all cross-origin requests by default; in production set to comma-separated origins,
    # e.g. "https://app.example.com,https://admin.example.com". In dev, set to "http://localhost:8081,http://localhost:3000".
    cors_origins: str = ""
    mtd_api_key: str = ""  # Champaign-Urbana MTD Developer API key (get at developer.cumtd.com)
    database_url: str = ""  # PostgreSQL connection URL (Railway sets DATABASE_URL automatically)

    # Optional API key auth (for production / multi-tenant). When enabled, requests must include X-API-Key or Authorization: Bearer <key>.
    api_key_required: bool = False
    api_keys: str = ""  # Comma-separated list of valid keys (no spaces). Example: API_KEYS=key1,key2

    # AI / Claude
    claude_api_key: str = ""  # Anthropic API key for AI features (get at console.anthropic.com)
    gtfs_db_path: str = "data/gtfs.db"  # Path to GTFS SQLite database (built by scripts/load_gtfs.py)

    # Google Places API (New) — set GOOGLE_PLACES_API_KEY in .env for place search
    google_places_api_key: str = ""

    # Share trips: base URL for share links (e.g. http://192.168.1.5:8000).
    # Falls back to request Host header if unset.
    public_base_url: str = ""

    # Supabase Auth — set SUPABASE_JWT_SECRET in Railway env vars (Settings → API → JWT Secret)
    supabase_jwt_secret: str = ""

    # Sentry error monitoring — set SENTRY_DSN in .env to enable
    sentry_dsn: str = ""


def get_settings() -> Settings:
    return Settings()
