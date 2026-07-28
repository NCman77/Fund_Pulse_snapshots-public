# Fund Pulse public snapshots

This repository is a public, raw-market-data boundary. It may contain only approved public market data and the code needed to collect, validate, and archive it.

It must never contain private Fund Pulse data, fund holdings, model outputs, training samples, credentials, tokens, cookies, databases, or Oracle VM details.

## Status

The initial Taiwan market configuration is intentionally disabled. Enable a collector only after its public source, symbol list, schedule, and output schema have been reviewed.

## Local checks

```powershell
npm test
npm run validate
```

See [the security boundary](docs/SECURITY_BOUNDARY.md) and [operations guide](docs/OPERATIONS.md) before enabling a workflow.
