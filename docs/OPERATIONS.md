# Operations

1. Review the market source and the exact public symbols.
2. Mark the market configuration `enabled: true` and `source.status: approved` only after review.
3. Implement a source adapter that emits only the raw snapshot schema.
4. Run `npm test` and `npm run validate` before committing.
5. Confirm workflow permissions, paths, concurrency, and session timings before scheduling it.

Raw files use `data/raw/{region}/{market}/{year}/{date}/{session}/{HHmm}.json`. `data/latest/{market}.json` contains only the latest snapshot. Daily manifests are created only by an archive workflow after market close.

