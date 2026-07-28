# Market schedules

`capture-public-markets.yml` runs hourly at minute 05 from 00:05–21:05 UTC on weekdays. The capture program is the authority for market time: it uses each market's IANA timezone, skips weekends and lunch breaks, and writes only while the configured regular session is open.

| Markets | Workflow write paths | Concurrency group | Schedule window (UTC) |
|---|---|---|---|
| TW, JP, KR, CN, SG | `data/raw/asia/{market}/...`, `data/latest/{market}.json`, `data/status/market-health.json` | `snapshot-public-markets` | hourly trigger; session resolver accepts 00:05–09:05 UTC as applicable |
| UK, EU | `data/raw/europe/{market}/...`, `data/latest/{market}.json`, `data/status/market-health.json` | `snapshot-public-markets` | hourly trigger; session resolver handles London/Paris daylight saving time |
| US | `data/raw/america/us/...`, `data/latest/us.json`, `data/status/market-health.json` | `snapshot-public-markets` | hourly trigger; session resolver handles New York daylight saving time |
| all configured markets | `data/manifests/{year}/{date}/{market}.json` | `archive-public-markets` | after each regional close |

Schedules are a trigger, not an assumption that a market is open. The collector records `isDelayed: true` because the public source may be delayed.
