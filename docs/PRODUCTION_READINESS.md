# Production Readiness Backlog

Living checklist of work needed to take UIUC Bustle from MVP to production-ready.
Maintained by the daily autonomous routine. Check items off as they land on `main`
and append a dated log entry below.

## Testing & CI
- [x] GitHub Actions CI running backend `pytest` and mobile `tsc`/`jest` on every PR
- [ ] Fix the ~25 pre-existing mobile `strict`-mode TypeScript errors, then make
      the CI typecheck step blocking (currently `continue-on-error`)
- [ ] Backend test coverage measured and reported (e.g. `pytest --cov`, fail under threshold)
- [ ] Mobile test coverage for core utils (nextClass, weatherEngine, crowding) expanded
- [ ] Integration test for the `/recommendation` happy path against a seeded GTFS db

## Security
- [x] Share-trip tokens raised to 128-bit entropy; public reads rate-limited (PR #7)
- [x] Crowding-report dedup derived server-side, not client-supplied (PR #7)
- [x] Constant-time API-key comparison (`secrets.compare_digest`)
- [x] JWT verification requires `exp`/`sub` claims (defense-in-depth)
- [ ] Rate-limit / optionally authenticate the billed outbound proxies (`/geocode`,
      `/autocomplete`, `/places/*`, `/directions/walk`) — Google Places is billed
- [ ] Trusted-proxy handling for `X-Forwarded-For` (currently taken as-is in logging)
- [ ] Per-user daily quota on AI endpoints to cap Anthropic spend

## Reliability & operability
- [x] Generic client-facing error for upstream MTD failures (no internal detail leak)
- [ ] Run the container as a non-root user (needs care: Railway volume `/mnt/data`
      ownership must be validated before merging — do not break the deploy)
- [ ] Structured request IDs / correlation IDs in logs
- [ ] Readiness vs. liveness split for `/health` (DB connectivity check)
- [ ] Graceful handling + retry/backoff for all outbound HTTP (MTD, Nominatim, OSRM)

## Configuration & deployment
- [x] Document all required env vars in one place (backend `.env.example`)
- [ ] Pin/lock backend dependency versions (hashes or a lockfile)
- [ ] CI step that builds the Docker image to catch build regressions

## Documentation
- [ ] API reference (FastAPI already exposes `/docs`; link + describe auth in README)
- [ ] Runbook: how to deploy, roll back, and rotate secrets

---

## Run log

### 2026-06-10 (first autonomous run)
- Established this backlog from the security review + a fresh production-readiness pass.
- Added GitHub Actions CI (backend pytest + mobile typecheck/tests).
- Hardened auth: constant-time API-key comparison; JWT now requires `exp`/`sub`.
- Stopped leaking internal upstream error strings to clients on MTD failures.
- Deferred the non-root Docker change pending validation of Railway volume ownership.
