# Fund Pulse public snapshots

This repository is a public, raw-data boundary. It may contain only approved public fund disclosures and market data, plus the code needed to collect, validate, and archive them.

Approved public fund disclosures include official NAV values, public holdings and weights, and public basic fund information. It must never contain private Fund Pulse model outputs, predictions, recommendations, calibration values, training samples, credentials, tokens, cookies, databases, or Oracle VM details.

## Status

The configured market collectors are enabled only after their public source, symbol list, schedule, and output schema have been reviewed. New funds, holdings-to-ticker mappings, markets, or sources require a reviewed public commit; this repository never reads a private repository to discover them.

## Local checks

```powershell
npm test
npm run validate
```

See [the security boundary](docs/SECURITY_BOUNDARY.md) and [operations guide](docs/OPERATIONS.md) before enabling a workflow.
