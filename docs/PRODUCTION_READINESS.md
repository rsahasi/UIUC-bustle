# Production Readiness Backlog

Living checklist of work needed to take UIUC Bustle from MVP to production-ready.
Maintained by the daily autonomous routine. Check items off as they land on `main`
and append a dated log entry below.

## Testing & CI
- [x] GitHub Actions CI running backend `pytest` and mobile `tsc`/`jest` on every PR
- [x] Mobile typecheck is clean (resolved by the Expo 54 migration) and the CI
      typecheck step is now blocking
- [ ] Backend test coverage measured and reported (e.g. `pytest --cov`, fail under threshold)
- [x] Mobile unit tests for core pure utils (distance, arriveBy, routeFormatting, crowding)
- [ ] Integration test for the `/recommendation` happy path against a seeded GTFS db

## Security
- [x] Share-trip tokens raised to 128-bit entropy; public reads rate-limited (PR #7)
- [x] Crowding-report dedup derived server-side, not client-supplied (PR #7)
- [x] Constant-time API-key comparison (`secrets.compare_digest`)
- [x] JWT verification requires `exp`/`sub` claims (defense-in-depth)
- [x] Rate-limit the billed/quota'd outbound proxies (`/geocode`, `/autocomplete`,
      `/places/*`, `/directions/walk`) per-IP
- [ ] Optionally *authenticate* the billed Google Places routes (rate-limited for now)
- [ ] Trusted-proxy handling for `X-Forwarded-For` (currently taken as-is in logging)
- [ ] Per-user daily quota on AI endpoints to cap Anthropic spend

## Reliability & operability
- [x] Generic client-facing error for upstream MTD failures (no internal detail leak)
- [ ] Run the container as a non-root user (needs care: Railway volume `/mnt/data`
      ownership must be validated before merging — do not break the deploy)
- [x] Request-id correlation: per-request id in logs + echoed X-Request-ID header
- [x] Readiness vs. liveness split: /health (liveness) + /health/ready (DB check)
- [ ] Graceful handling + retry/backoff for all outbound HTTP (MTD, Nominatim, OSRM)

## Configuration & deployment
- [x] Document all required env vars in one place (backend `.env.example`)
- [ ] Pin/lock backend dependency versions (hashes or a lockfile)
- [x] Always-on cloud schedule: .github/workflows/daily-agent.yml runs the routine
      server-side (needs an ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN secret)
- [ ] CI step that builds the Docker image to catch build regressions

## Documentation
- [x] API reference: README documents /docs, health/readiness/metrics, and auth
- [ ] Runbook: how to deploy, roll back, and rotate secrets

---

## Run log

### 2026-06-10 (first autonomous run)
- Established this backlog from the security review + a fresh production-readiness pass.
- Added GitHub Actions CI (backend pytest + mobile typecheck/tests).
- Hardened auth: constant-time API-key comparison; JWT now requires `exp`/`sub`.
- Stopped leaking internal upstream error strings to clients on MTD failures.
- Deferred the non-root Docker change pending validation of Railway volume ownership.

### 2026-06-12
- Repaired 6 tests broken by the JWKS auth refactor (stub get_unverified_header).
- Added an always-on cloud scheduler (GitHub Actions `daily-agent.yml`) so the daily
  routine runs server-side; requires a one-time API/OAuth secret to activate.

### 2026-06-13
- Bug hunt + fixes (all with tests where feasible; full suite 105 passed):
  - PATCH /schedule/classes with `location_name` → 500 (no such column); removed the
    dangling field from backend whitelist/model and the mobile type.
  - JWKS auth returned 503 instead of 401 for unknown-key ES256/RS256 tokens
    (PyJWKClientError isn't an InvalidTokenError); now mapped to 401, with the first
    tests for the asymmetric path.
  - /recommendation ran the blocking Claude SDK call on the event loop; moved to
    asyncio.to_thread.
  - AI ranked_order now requires a valid permutation before reordering options.

### 2026-06-14
- Coverage improvements (no behavior change): +20 mobile util tests (distance,
  arriveBy, routeFormatting, crowding); +4 tests for the startup GTFS->Postgres
  stops seeding (previously zero coverage); +2 tests for the MTD client retry/backoff
  and exhaustion paths. Backend 105 -> 111 passed; mobile 43 -> 63 passed.

### 2026-06-15
- Repo hygiene: untracked the stray mobile/node_modules symlink (pointed at a
  foreign absolute path; broke on every checkout) and hardened the gitignore.
- CI: flipped the mobile typecheck to blocking now that tsc is clean (0 errors)
  after the Expo 54 migration.

