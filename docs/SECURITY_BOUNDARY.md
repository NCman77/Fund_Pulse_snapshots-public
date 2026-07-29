# Security boundary

Data flows one way only: this public repository may publish approved public raw data; the private Fund Pulse repository or Oracle VM may read it. No public workflow, code, log, commit, or configuration may read from or reveal private systems.

Approved public raw data may include explicitly reviewed fund identifiers and names, official NAV disclosures, public holdings and weights, public holding-to-ticker mappings, market calendars, public prices, FX, source URLs, and capture or disclosure timestamps. Publishing one of these items means it is intentionally public and must be traceable to a public source.

Never commit keys, tokens, cookies, private API responses, personal user data, private watchlists, model formulas, feature values, model scores, rankings, recommendations, predicted NAV values, calibration values, training labels or samples, private results, databases, or Oracle VM details.

Every workflow uses only `contents: write`. Workflows triggered by `pull_request` must not have write permissions or secrets.
