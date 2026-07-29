# Public universe policy

The approved ticker universe is an explicit public configuration. Each entry contains only a publicly tradable symbol, market, and currency. The collector reads this configuration with the market-index configuration and records raw public quotes directly from the public source.

`config/public-holdings/approved-holding-symbols.json` is the companion public mapping. It maps only an explicitly reviewed public holding name to a public ticker, market, and currency. The market collector adds these approved symbols automatically. A holding without a mapping is reported as `unmapped`; the collector must never guess a ticker from a similar name.

This repository does not read a private repository at runtime. Any addition to the universe is a reviewed public commit. It must not add model features, calibration data, predictions, training labels, recommendation fields, or private runtime metadata.

Fund holdings disclosures may be added only through a source approved for this repository. The project owner has approved the MoneyDJ public disclosure source; this approval and the source terms must be reviewed again before changing the source or broadening redistribution.

The approved MoneyDJ public disclosure collector stores only source URLs, disclosed NAV values, public manager names, disclosure dates, holding names, share counts, weights, monthly disclosed changes, and public industry / holding-class weights. It does not store any model output, prediction, calibration, training label, data-quality score, or private result.

After every fund-disclosure capture, `data/funds/coverage/latest.json` and `data/status/holding-mapping-health.json` show which disclosed holdings are already mapped and which need a reviewed public mapping. This makes a new approved public fund safe to onboard: known holdings begin receiving market snapshots; unknown holdings stay visible for review instead of being silently substituted.
