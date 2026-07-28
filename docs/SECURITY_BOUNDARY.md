# Security boundary

Data flows one way only: this public repository may publish approved public raw market data; the private Fund Pulse repository or Oracle VM may read it. No public workflow, code, log, commit, or configuration may read from or reveal private systems.

Never commit keys, tokens, Yahoo cookies, private API responses, user data, holdings, fund-to-ticker mappings, model formulas, scores, rankings, predictions, calibration values, or training samples.

Every workflow uses only `contents: write`. Workflows triggered by `pull_request` must not have write permissions or secrets.

