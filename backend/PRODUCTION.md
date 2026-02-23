# Production deployment checklist

## Environment variables

Copy and adjust for production. Development defaults are fine for local use.

| Variable | Default | Production |
|---------|---------|------------|
| `CORS_ORIGINS` | `*` | Comma-separated origins, e.g. `https://yourapp.com` |
| `API_KEY_REQUIRED` | `false` | `true` to require API key |
| `API_KEYS` | (empty) | Comma-separated keys when `API_KEY_REQUIRED=true` |
| `DEBUG` | `false` | Keep `false` |
| `MTD_API_KEY` | (empty) | Your MTD developer key |

## Monitoring

- **Request logging**: Every request is logged with `method`, `path`, `status`, `duration_ms`, `client` (IP). Use structured logging (e.g. JSON) by configuring Python `logging` handlers.
- **Metrics**: `GET /metrics` returns JSON with `requests_total`, `requests_2xx`, `requests_4xx`, `requests_5xx`, `uptime_seconds`. Exempt from rate limit and API key. For production, consider a Prometheus exporter or your APM’s agent instead of this in-memory counter.
- **Health**: `GET /health` is exempt from rate limit and auth; use it for load balancer health checks.

## CORS

- **Development**: `CORS_ORIGINS=*` (default).
- **Production**: Set `CORS_ORIGINS` to a comma-separated list of allowed origins (no spaces), e.g.:
  ```bash
  CORS_ORIGINS=https://yourapp.com,https://admin.yourapp.com
  ```
- The app does not allow wildcard subdomains; list each origin explicitly.

## Optional API key auth

When you need to restrict access or support multiple tenants:

1. Set in `.env`:
   ```bash
   API_KEY_REQUIRED=true
   API_KEYS=your-secret-key,another-key
   ```
2. Clients must send one of:
   - Header: `X-API-Key: your-secret-key`
   - Header: `Authorization: Bearer your-secret-key`
3. **Exempt paths** (no key required): `/health`, `/metrics`.
4. Invalid or missing key → `401` with `{"detail": "Invalid or missing API key. Provide X-API-Key or Authorization: Bearer <key>."}`.

**Mobile app**: In Settings, enter the API key and save; the app sends it on all API requests when set.

## Security notes

- Run behind a reverse proxy (e.g. nginx, Caddy) for TLS and to set `X-Forwarded-For` / `X-Forwarded-Proto`.
- Keep `DEBUG=false` in production.
- Store `API_KEYS` and `MTD_API_KEY` in secrets (env or secret manager), not in code.
- Rate limiting is per-IP (100/minute); if you use API keys, consider per-key limits in the future.
