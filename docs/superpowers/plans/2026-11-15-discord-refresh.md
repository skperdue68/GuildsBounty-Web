# Discord integration refresh

Goal: update PR #111 for current Guild's Bounty main without changing GuildSync.

1. Merge current main; retain the latest README and all npm checks.
2. Add failing stock regressions for reported Always Share quantities, keep-back reserves, unknown/zero stock and pending holds. Match the website's one-copy-per-offer-request rule.
3. Fix the bot stock query and quantity controls; preserve scoped authorization and website basket isolation.
4. Add a notification regression and call the existing owner badge hook after a committed bot request, before email delivery.
5. Refresh bot-facing branding and setup/interaction documentation. Keep environment names, schema names, repository paths and addon identity compatible.
6. Run all database-free website checks, bot/API/store regressions and syntax/whitespace checks. Review the final diff, then push to the existing development branch and update draft PR #111.

Live Discord, MariaDB and email validation remain a test-installation acceptance step. No production deployment or GuildSync changes are authorized.

Validation on November 15, 2026: all 30 database-free suites passed, including 17 standalone client/API transport tests, eight backend API/identity-reader tests, the postcommit notifier test and the expanded store regressions. Command serialization built all eight subcommands; syntax and whitespace checks passed. The standalone dependency update to discord.js 14.28.1 audited with zero reported vulnerabilities. The existing reserve-dialog test now normalizes Windows line endings (21 checks pass). Independent review found no actionable issues. The MariaDB fulfillment test could not authenticate with the local server; no live Discord registration, email delivery or production deployment was performed.
