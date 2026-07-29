# Public fund onboarding

The public repository never reads a private repository or private website to discover funds.

## Current safe flow

1. Add the public fund identifier and public name to `config/public-funds/approved-funds.json` in a reviewed public commit.
2. The next public fund-disclosure workflow captures its public NAV, basic information, and disclosed holdings.
3. The coverage builder matches holdings only against `config/public-holdings/approved-holding-symbols.json`.
4. A mapped holding in an already configured market is included automatically in that market's next collector run. Unmapped names, and holdings for a market that has not been configured, remain visible for explicit review in `data/status/holding-mapping-health.json`.

Adding a fund must not infer a new country, exchange, trading hours, holiday calendar, or ticker from a holding name. A newly required market needs its own reviewed public configuration before collection begins.

## Future private-site automation

If the owner later authorizes a private-site change, adding a fund there may create a public registration request containing only the already-public fund ID and name. It must not send user identity, watchlist metadata, model configuration, predictions, or private results. The public side must validate the fund ID and preserve a reviewed public audit trail before it begins collection.

This document intentionally does not implement that private-site change.
