# Market calendar policy

The session resolver first applies market timezone, weekend, configured closure dates, and configured special sessions. It then requires every collected public quote to contain a bar dated in that market's local calendar day. A stale prior-day bar is rejected, so a holiday, ad-hoc closure, or missed calendar update cannot create a false new snapshot.

`closedDates` is reserved for verified exchange closure dates. `specialSessions` overrides ordinary hours for verified early closes. Calendar changes must be reviewed annually against the primary exchange calendar, not inferred from a country's public-holiday list.

The 2026 US early closes are taken from the NYSE calendar. The 2026 UK year-end half day is taken from the London Stock Exchange business-day calendar. Source URLs and the review date belong in the pull request that changes a calendar file.
