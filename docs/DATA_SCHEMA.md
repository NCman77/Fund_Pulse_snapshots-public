# Data schemas

`schemas/raw-snapshot.schema.json` defines a single public quote snapshot. It holds a source identifier, timestamp, market, session, delay flag, and standard quote fields only.

`schemas/daily-manifest.schema.json` defines an archive created after market close. It references raw snapshot paths and checksums; it does not copy or infer model data.

`data/funds/nav/{fundId}/{navDate}.json` is an immutable public official-NAV archive. It records only the published NAV date/value, disclosure capture time, public source URLs, and its raw disclosure path. It must never contain a predicted NAV, comparison result, or training field.
