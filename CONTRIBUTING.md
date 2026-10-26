# Contributing to NIVIO Test Suite

Thank you for helping improve NIVIO Test Suite. This guide explains how to set up the
project and what a pull request must pass.

## Before you start

Open an issue first for larger changes, so the scope can be agreed before you build.
The maintainers decide which features fit the product.

## Development setup

Requirements: Bun 1.3, and PowerShell 7 for Page Script replay on macOS.

```bash
bun install
bun run dev
```

## Checks

Every pull request must pass:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

Add focused tests wherever behavior changes, including tests for rejected input.

## Data you must never commit

Never commit credentials, tenant IDs, user names, run evidence, screenshots or reports
from a real Business Central environment. Use placeholders such as
`00000000-0000-0000-0000-000000000000` and `contoso.onmicrosoft.com`.

## Pull requests

- Keep each pull request to one coherent change.
- Write code, identifiers, comments and commit messages in English.
- Describe what changed, why, and which checks you ran.
- By submitting a contribution you agree that it is licensed under the
  [Apache License 2.0](LICENSE), as described in section 5 of that license.

## Conduct

Everyone taking part in this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
