# Public fund onboarding

The public repository never reads a private repository or private website to discover funds.

## Current safe flow

1. Add the public fund identifier and public name to `config/public-funds/approved-funds.json` in a reviewed public commit, or let the authorized private-site registration send those same two public fields through the `fund-pulse-register-public-fund` GitHub dispatch event.
2. The next public fund-disclosure workflow captures its public NAV, basic information, and disclosed holdings.
3. The coverage builder matches holdings only against `config/public-holdings/approved-holding-symbols.json`.
4. A mapped holding in an already configured market is included automatically in that market's next collector run. Unmapped names, and holdings for a market that has not been configured, remain visible for explicit review in `data/status/holding-mapping-health.json`.

Adding a fund must not infer a new country, exchange, trading hours, holiday calendar, or ticker from a holding name. A newly required market needs its own reviewed public configuration before collection begins.

## Authorized private-site registration

The private site may request registration only by dispatching an event with exactly `fundId` and `name`. The public workflow rejects every other field and adds a fund only when the identifier is not already present; it never overwrites an existing public entry. The request must not send user identity, watchlist metadata, model configuration, predictions, training data, or private results. GitHub's resulting public commit is the audit trail.
