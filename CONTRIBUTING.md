# Contributing

Bug reports, ideas, documentation improvements, and code contributions are
welcome. Open an issue with your environment, reproduction steps, and expected
behavior. For larger changes, discuss the design in an issue first.

## Development

Use Node.js 24+ and pnpm 10.20.0.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @mango-write/surveys-standalone-example typecheck
pnpm --filter @mango-write/surveys-standalone-example test
pnpm --filter @mango-write/surveys-standalone-example web:build
```

Set `TEST_DATABASE_URL` to an isolated PostgreSQL server for database tests. The
tests create and drop `mango_surveys_test`. Include focused tests for changed
behavior and update the relevant documentation.

## Contribution agreement

Contributors retain copyright in their work. Code contributions use a separate
contributor agreement that supports the project's open-source and additional
licensing options. Maintainers arrange the agreement during review, before merge.
The public project is licensed under AGPL-3.0-or-later.
