# Fund Pulse — Public Market Snapshots

This repository stores only reproducible public inputs: approved market quotes, public fund disclosures, and integrity manifests. Model formulas, estimates, private calibration data, and private fund-analysis results never belong here.

## Snapshot policy

- A session watcher starts before its first slot and remains active through that market session.
- Each scheduled slot records `scheduledAt`, `capturedAt`, each quote's `quoteAt`, `captureDelaySeconds`, and `timingStatus`.
- A slot that cannot be captured is retried up to three times. Its failure is recorded, but later slots continue to run.
- Session reports are written to `data/status/sessions/<market>/` with expected, captured, on-time, late, and failed slot counts.
- A completed GitHub Actions run is not by itself evidence of usable data. Consumers must inspect the saved slot timing and session report.

`on_time` currently means the final capture completed no more than 120 seconds after its scheduled instant. A quote must also be evaluated for freshness through its own `quoteAt`; a punctual capture of stale source data is not suitable for time-sensitive analysis.

## Taiwan market

All times below are Asia/Taipei, on reviewed Taiwan trading days.

| Role | Start time | Snapshot slots |
|---|---:|---|
| Main full-day watcher | 07:45 | 09:05, 10:00, 10:30, 11:00, 11:30, 12:00, 12:30, **12:55**, 13:00, 13:25, 13:30 |
| Independent pre-order backup | 12:45 | **12:55** |

For Taiwan-fund analysis, 12:55 is the primary pre-order reference point because Taiwan fund subscription decisions close before 13:00. The backup watcher improves availability of that critical point, but a saved snapshot is accepted only when its persisted timing and quote freshness meet the applicable policy.

## International markets

The following are the main watcher slots. Times are **local to each market** and use the workflow's IANA timezone, including daylight-saving changes where applicable. Each morning and afternoon session is isolated from the others so an error in one market/session does not stop the rest.

| Market | Morning / first session slots | Afternoon / later session slots |
|---|---|---|
| Japan (`Asia/Tokyo`) | 09:05, 09:35, 10:05, 10:35, 11:05, 11:30 | 12:35, 13:05, 13:35, 14:05, 14:35, 15:05, 15:30 |
| Korea (`Asia/Seoul`) | 09:05, 09:35, 10:05, 10:35, 11:05, 11:35, 12:05 | 12:35, 13:05, 13:35, 14:05, 14:35, 15:05, 15:30 |
| China (`Asia/Shanghai`) | 09:35, 10:05, 10:35, 11:05, 11:30 | 13:05, 13:35, 14:05, 14:35, 15:00 |
| Singapore (`Asia/Singapore`) | 09:05, 09:35, 10:05, 10:35, 11:05, 11:35, 12:00 | 13:05, 13:35, 14:05, 14:35, 15:05, 15:35, 16:05, 16:35, 17:00 |
| United Kingdom (`Europe/London`) | 08:05, 08:35, 09:05, 09:35, 10:05, 10:35, 11:05, 11:35, 12:05 | 12:35, 13:05, 13:35, 14:05, 14:35, 15:05, 15:35, 16:05, 16:30 |
| Europe (`Europe/Paris`) | 09:05, 09:35, 10:05, 10:35, 11:05, 11:35, 12:05, 12:35, 13:05 | 13:35, 14:05, 14:35, 15:05, 15:35, 16:05, 16:35, 17:05, 17:30 |
| United States (`America/New_York`) | 09:35, 10:05, 10:35, 11:05, 11:35, 12:05, 12:35, 13:05 | 13:35, 14:05, 14:35, 15:05, 15:35, 16:00 |

International market snapshots currently provide public audit and historical-reference data. They are not automatically converted into international-fund training samples. Any future training policy must define a decision basis before using them:

1. **Taipei 12:55 decision basis** — suitable for a Taiwan-distributed fund whose actionable subscription deadline is before 13:00. At that point, use the latest verified quote for every underlying market and explicitly preserve its market/quote time.
2. **Underlying-market close basis** — suitable for evaluating how the fund's holdings behaved by their own exchanges. It is a separate cross-market measurement and must not be mixed with the Taipei 12:55 decision sample.

These two bases may both be stored and analysed, but they must remain separately labelled and must not be combined into one accuracy or training population.

### Taipei 12:55 international decision backup

The independent `Backup international decision-time public snapshots` workflow starts at **12:40 Asia/Taipei** and remains active for the two overseas exchanges that are open at the Taiwan 12:55 decision point:

| Market | Local decision slot | Why it is captured |
|---|---:|---|
| Japan | 13:55 Asia/Tokyo | The Tokyo afternoon session is open at Taipei 12:55. |
| Korea | 13:55 Asia/Seoul | The Seoul regular session is open at Taipei 12:55. |

Taiwan is covered by its separate 12:55 backup watcher. China and Singapore are in their configured lunch break at this point; the United Kingdom, Europe, and the United States have not opened. For those closed markets, a Taiwan 12:55 decision sample must retain the last verified available quote and its own `quoteAt` rather than fabricate an intraday quote.

## Proposed data acceptance tiers

The public repository records the evidence needed for these tiers. The private project must explicitly implement this policy before any near-time record can be used for training or calibration.

| Tier | Capture delay | Use |
|---|---:|---|
| Primary | 0–120 seconds, with fresh quotes | Decision-time accuracy and primary training / calibration samples |
| Near-time | 121–300 seconds, with fresh quotes | Separate analysis or lower-weight shadow evaluation; never labelled as an exact decision-time sample |
| Diagnostic | More than 300 seconds, missing timing, or stale quotes | Historical diagnostics only; excluded from training |

The private Fund Pulse project verifies manifests and imports only public raw data. It creates any private model outputs separately and must retain provenance back to these public files.
