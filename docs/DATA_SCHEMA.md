# Data schemas

`schemas/raw-snapshot.schema.json` defines a single public quote snapshot. It holds a source identifier, timestamp, market, session, delay flag, and standard quote fields only.

`schemas/daily-manifest.schema.json` defines an archive created after market close. It references raw snapshot paths and checksums; it does not copy or infer model data.

