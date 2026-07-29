# Market schedules

`capture-tw-session.yml` and `capture-international-market-sessions.yml` start long session watchers shortly before each configured local market session. Japan, China, Singapore, the United Kingdom, and the United States have separate morning and afternoon watchers where appropriate; every watcher exits after its own final slot. `capture-public-markets.yml` is retained as a manual fallback only. The capture program is the authority for market time: it uses each market's IANA timezone, skips weekends, configured exchange closures, early closes, and lunch breaks, and writes only while the configured regular session is open.

The Taiwan reference slots are 09:05, 10:00, 10:30, 11:00, 11:30, 12:00, 12:30, 12:55, 13:00, 13:25, and 13:30 (Asia/Taipei). GitHub-hosted schedules are best effort, not a clock guarantee: every raw snapshot therefore contains its actual `capturedAt`, `quoteAt`, triggering `scheduleRule`, resolved `scheduledAt`, and `captureDelaySeconds`. A snapshot delayed by more than 120 seconds receives `timingStatus: late`; a private consumer must reject it from training rather than silently treating it as on time.

| Markets | Workflow write paths | Concurrency group | Schedule window (UTC) |
|---|---|---|---|
| TW | `data/raw/asia/tw/...`, `data/latest/tw.json` | `session-watch-tw-full-day` | Long watcher starts 08:35 Asia/Taipei; it captures each approved Taiwan reference slot and commits each capture independently |
| JP, KR, CN, SG | `data/raw/asia/{market}/...`, `data/latest/{market}.json` | `session-watch-{market}-{morning\|afternoon}` | One watcher per configured local session; session resolver handles holidays and lunch breaks |
| UK, EU | `data/raw/europe/{market}/...`, `data/latest/{market}.json` | `session-watch-{market}-{morning\|afternoon}` | One watcher per configured local session; handles London/Paris daylight saving time |
| US | `data/raw/america/us/...`, `data/latest/us.json` | `session-watch-us-{morning\|afternoon}` | Two watchers cover the New York session and daylight saving time without an overnight Taiwan-time run |
| all configured markets | `data/manifests/{year}/{date}/{market}.json` | `archive-public-markets` | after each regional close |

Schedules are a trigger, not an assumption that a market is open. The collector records `isDelayed: true` because the public source may be delayed, and accepts only quotes dated in that market's current local trading day.
