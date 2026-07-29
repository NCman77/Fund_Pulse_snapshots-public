# Fund Pulse public snapshots

This repository is a public, raw-data boundary. It may contain only approved public fund disclosures and market data, plus the code needed to collect, validate, and archive them.

Approved public fund disclosures include official NAV values, public holdings and weights, and public basic fund information. It must never contain private Fund Pulse model outputs, predictions, recommendations, calibration values, training samples, credentials, tokens, cookies, databases, or Oracle VM details.

## Status

The configured market collectors are enabled only after their public source, symbol list, schedule, and output schema have been reviewed. A private-site registration may add a fund through a restricted GitHub dispatch that contains only its public ID and name; this repository never reads a private repository to discover funds or any private data.

## What this repository collects

- Approved public fund disclosures for 19 funds: official NAV, public manager/basic information, disclosed holdings, share counts, weights, industry weights, and holding-class weights.
- Approved public indices and ticker quotes for Taiwan, Japan, Korea, China, Singapore, the United Kingdom, Euronext Paris, and the United States.
- Public market calendars, including local time zones, lunch breaks, 2026 exchange closures, and verified early-close sessions.
- Raw source timestamps and checksummed daily manifests so a private consumer can verify exactly which public inputs it used.
- Immutable official-NAV records keyed by each fund's published NAV date, including the public disclosure timestamp and source raw-file path.

The repository is deliberately not a valuation engine. It contains no model formulas, features, confidence scores, recommendations, predicted NAV values, calibration data, training labels, or private results.

## Fund holding coverage

After each public fund-disclosure capture, the repository produces a public coverage file at `data/funds/coverage/latest.json`. It records each disclosed holding's public name, published weight, reviewed ticker mapping, market, and currency. The market collector includes each approved mapping for its configured market on its next run.

No ticker, country, or exchange is guessed. Unknown holding names and holdings that need an unsupported market are listed in `data/status/holding-mapping-health.json` until a reviewed public mapping and, where necessary, a reviewed market-calendar configuration are added. The public onboarding process is documented in [FUND_ONBOARDING.md](docs/FUND_ONBOARDING.md).

## Scheduled collection

Every configured market uses a GitHub-hosted session watcher. Each watcher starts shortly before its local market session, captures its approved slots from the already-running job, then exits. Splitting markets with a midday recess into morning and afternoon watchers keeps every job well below GitHub's six-hour job limit and avoids a separate scheduled workflow starting late at a critical slot such as Taiwan 12:55.

| Data | Schedule | Behaviour |
|---|---|---|
| Japan, Korea, China, Singapore, Europe, United States | One or two local-session watchers per market, according to the configured trading sessions | The session resolver checks local time zone, lunch break, exchange closure, and early close before writing data. Each snapshot is committed while its watcher is running. |
| Taiwan pre-order reference snapshots | One watcher starts at 08:35 Asia/Taipei and captures 09:05, 10:00, 10:30, 11:00, 11:30, 12:00, 12:30, 12:55, 13:00, 13:25, and 13:30 | The runner remains active through the trading session, preserving the public inputs around the private project's pre-order decision window. |
| Public fund disclosures | Weekdays at 18:35 Asia/Taipei | Captures changed public NAV and disclosure pages for the approved fund list. |
| Daily market manifests | After regional market closes | Creates checksummed manifests for completed local market sessions. |

Europe and the United States are not forced into Taiwan hours. The same scheduler checks `Europe/London`, `Europe/Paris`, and `America/New_York`, so their regular sessions and daylight-saving changes are handled in local market time. Raw files use the market's local trading date, including US sessions that cross the Taiwan calendar date.

## Timing quality

GitHub Actions schedules are best effort, so a trigger is not proof that a snapshot was collected on time. Every newly captured market snapshot records:

- `scheduledAt`: the intended UTC run time derived from the workflow schedule;
- `capturedAt`: the actual collection time;
- `quoteAt`: the source quote time;
- `captureDelaySeconds`: actual delay from the intended time;
- `timingStatus`: `on_time`, `late`, or `manual_or_unknown`.

Snapshots delayed by more than 120 seconds are marked `late`. A future private consumer must retain them for diagnostics but exclude them from training or accuracy statistics that require an on-time snapshot.

GitHub-hosted Actions cannot guarantee the 12:55 Taiwan sample. If near-guaranteed timing is required later, run a separate collector on a user-selected, continuously available machine. That collector must have permission only to publish approved public data to this repository; it must not access the private repository, model, or results.

## Calendar policy

Each enabled market configuration records its 2026 review date and source URL. The collector rejects a prior-market-day quote even if a holiday or unscheduled closure was not yet configured, preventing a stale quote from being mislabelled as today's market data. See [the calendar policy](docs/MARKET_CALENDAR_POLICY.md) and [detailed schedule notes](docs/MARKET_SCHEDULES.md).

## Local checks

```powershell
npm test
npm run validate
```

See [the security boundary](docs/SECURITY_BOUNDARY.md) and [operations guide](docs/OPERATIONS.md) before enabling a workflow.
