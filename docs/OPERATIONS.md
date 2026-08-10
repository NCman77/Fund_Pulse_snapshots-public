# Operations

1. Review the market source and the exact public symbols.
2. Mark the market configuration `enabled: true` and `source.status: approved` only after review.
3. Implement a source adapter that emits only the raw snapshot schema.
4. Run `npm test` and `npm run validate` before committing.
5. Confirm workflow permissions, paths, concurrency, and session timings before scheduling it.

Producer-isolated raw files use `data/raw/{region}/{market}/{year}/{date}/{session}/producers/{producerId}/{HHmm}.json`; legacy raw files without producer identity remain readable. `data/latest/{market}.json` contains only the latest verified projection and is written by the per-market publisher, never by a watcher. Daily manifests are created only by an archive workflow after market close.

If no eligible raw snapshot can be selected, the publisher preserves the previous verified latest and writes `data/status/markets/{market}.json` as `stale` with `reason: no_verified_raw_snapshot`. An eligible backup may replace the projection only when no eligible primary exists for that slot, and the latest/status records retain the fallback reason.

The UK and EU warm-standby tail handoff is intentionally the only scheduled overlap with primary session ownership. It covers exactly each market's reviewed `s4` and `s5` slots, uses a `*-tail-handoff-backup` producer ID, and writes a separate immutable producer path. Decision-slot workflows named `decision-owner` remain the sole primary owner of their slot even though their historical workflow filenames contain `backup`.

Yahoo Chart collection uses the reviewed settings in `config/policies/retry-policy.json`: bounded concurrency, retryable-status handling, timeout classification, and capped exponential backoff with jitter. Environment variables documented in `.env.example` may override these values for an operational test without changing slot schedules.

Session reports use schema version `1.1`. Each slot records symbol coverage and sanitized failure diagnostics (provider, endpoint type, status/error class, schema state, symbol, attempt, backoff, slot, and workflow identity). Response bodies, response headers, request URLs, cookies, tokens, and query data are never persisted. A non-publishable capture attempt may be retained under `data/partial/` for audit when a symbol is missing; partial data is never eligible for raw snapshot selection, and the session report marks that slot partial and unhealthy.

