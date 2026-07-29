# Market schedules

`capture-public-markets.yml` starts a short-lived job every 30 minutes from 00:05–21:35 UTC on weekdays, plus the Taiwan pre-order reference slots. It never waits through a trading day. The capture program is the authority for market time: it uses each market's IANA timezone, skips weekends, configured exchange closures, early closes, and lunch breaks, and writes only while the configured regular session is open.

The Taiwan reference slots are 09:05, 10:00, 10:30, 11:00, 11:30, 12:00, 12:30, 12:55, 13:00, 13:25, and 13:30 (Asia/Taipei). GitHub-hosted schedules are best effort, not a clock guarantee: every raw snapshot therefore contains its actual `capturedAt`, `quoteAt`, and triggering `scheduleRule`. A private consumer must reject a late snapshot from training rather than silently treating it as on time.

| Markets | Workflow write paths | Concurrency group | Schedule window (UTC) |
|---|---|---|---|
| TW, JP, KR, CN, SG | `data/raw/asia/{market}/...`, `data/latest/{market}.json`, `data/status/market-health.json` | `snapshot-public-markets` | 30-minute trigger; Asia/Taipei 08:05–17:35 is covered and only local open sessions write data |
| UK, EU | `data/raw/europe/{market}/...`, `data/latest/{market}.json`, `data/status/market-health.json` | `snapshot-public-markets` | 30-minute trigger; session resolver handles London/Paris daylight saving time |
| US | `data/raw/america/us/...`, `data/latest/us.json`, `data/status/market-health.json` | `snapshot-public-markets` | 30-minute trigger; session resolver handles New York daylight saving time and the Taiwan-date rollover |
| all configured markets | `data/manifests/{year}/{date}/{market}.json` | `archive-public-markets` | after each regional close |

Schedules are a trigger, not an assumption that a market is open. The collector records `isDelayed: true` because the public source may be delayed, and accepts only quotes dated in that market's current local trading day.
