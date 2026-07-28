# Public universe policy

The approved ticker universe is an explicit public configuration. Each entry contains only a publicly tradable symbol, market, and currency. The collector reads this configuration with the market-index configuration and records raw public quotes directly from the public source.

This repository does not read a private repository at runtime. Any addition to the universe is a reviewed public commit. It must not add model features, calibration data, predictions, training labels, recommendation fields, or private runtime metadata.

Fund holdings disclosures may be added only through a source approved for this repository. The project owner has approved the MoneyDJ public disclosure source; this approval and the source terms must be reviewed again before changing the source or broadening redistribution.

The approved MoneyDJ public disclosure collector stores only source URLs, disclosed NAV values, public manager names, disclosure dates, holding names, share counts, weights, monthly disclosed changes, and public industry / holding-class weights. It does not store any model output, prediction, calibration, training label, data-quality score, or private result.
