# Market calendar policy

The session resolver first applies market timezone, weekend, configured closure dates, and configured special sessions. It then requires every collected public quote to contain a bar dated in that market's local calendar day. A stale prior-day bar is rejected, so a holiday, ad-hoc closure, or missed calendar update cannot create a false new snapshot.

`closedDates` is reserved for verified exchange closure dates. `specialSessions` overrides ordinary hours for verified early closes. Every enabled market configuration records the review date and the calendar source URL. Calendar changes must be reviewed annually against the primary exchange calendar, not inferred from a country's public-holiday list.

The current configurations contain the reviewed 2026 schedules for TWSE, JPX, KRX, SSE, SGX, LSE, Euronext Paris, and NYSE. Source URLs and the review date belong in the pull request that changes a calendar file.
