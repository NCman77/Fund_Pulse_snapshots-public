# Data schemas

`schemas/raw-snapshot.schema.json` defines a single public quote snapshot. It holds a source identifier, timestamp, market, session, delay flag, and standard quote fields only.

`schemas/daily-manifest.schema.json` defines an archive created after market close. It references raw snapshot paths and checksums; it does not copy or infer model data.

`data/status/sessions/{market}/{date}-{session}.json` records session report schema `1.1`. Slot entries preserve capture timing, quote coverage, and sanitized collector diagnostics. A slot with a saved raw snapshot but incomplete symbol coverage is reported as partial and is not considered healthy.

`data/latest/{market}.json` is a mutable verified projection selected from immutable raw snapshots. Its `verification` object records the selected `sourcePath`, source checksum, producer identity/role, and `fallbackReason`. An eligible primary producer wins over a backup for the same slot; an eligible backup is published only with `fallbackReason: primary_missing_or_unverified_for_slot`.

`data/status/markets/{market}.json` records the per-market publisher state. When no eligible raw snapshot exists, the previous verified latest file remains unchanged while this status becomes `stale` with `reason: no_verified_raw_snapshot`.

`data/funds/nav/{fundId}/{navDate}.json` is an immutable public official-NAV archive. It records only the published NAV date/value, disclosure capture time, public source URLs, and its raw disclosure path. It must never contain a predicted NAV, comparison result, or training field.
