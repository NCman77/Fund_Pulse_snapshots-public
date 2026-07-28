# Public universe policy

The approved ticker universe is an explicit public configuration. Each entry contains only a publicly tradable symbol, market, and currency. The collector reads this configuration with the market-index configuration and records raw public quotes directly from the public source.

This repository does not read a private repository at runtime. Any addition to the universe is a reviewed public commit. It must not add model features, calibration data, predictions, training labels, recommendation fields, or private runtime metadata.

Fund holdings disclosures may be added only through a source that permits automated collection and public redistribution. Until that source review is complete, this repository stores the approved public ticker universe rather than copying third-party disclosure pages.
