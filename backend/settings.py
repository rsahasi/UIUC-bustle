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
    # CORS: "*" for dev; in production set to comma-separated origins, e.g. "https://app.example.com,https://admin.example.com"
    cors_origins: str = "*"
    mtd_api_key: str = ""  # Champaign-Urbana MTD Developer API key (get at developer.cumtd.com)
    stops_db_path: str = "data/stops.db"  # Path relative to backend root, or absolute
    app_db_path: str = "data/app.db"  # Buildings + schedule (run scripts/seed_buildings.py first)

    # Optional API key auth (for production / multi-tenant). When enabled, requests must include X-API-Key or Authorization: Bearer <key>.
    api_key_required: bool = False
    api_keys: str = ""  # Comma-separated list of valid keys (no spaces). Example: API_KEYS=key1,key2

    # AI / Claude
    claude_api_key: str = ""  # Anthropic API key for AI features (get at console.anthropic.com)
    gtfs_db_path: str = "data/gtfs.db"  # Path to GTFS SQLite database (built by scripts/load_gtfs.py)


def get_settings() -> Settings:
    return Settings()
