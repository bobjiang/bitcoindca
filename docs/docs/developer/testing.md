---
title: Testing Playbooks
sidebar_label: Testing
description: Guidance on running, extending, and interpreting the DCA Crypto smart contract and frontend test suites.
---

# Testing Playbooks

DCA Crypto enforces strict testing requirements for every public/external change. Follow this guide to run existing suites and expand coverage.

## Test suites

| Package | Command | Purpose |
| --- | --- | --- |
| `contracts` | `pnpm --filter ./contracts test` | Hardhat-based unit, integration, and security tests. |
| `contracts` | `pnpm --filter ./contracts build` | Solidity compilation and ABI generation. |
| `frontend` | `pnpm --filter ./frontend test` | Component and hook tests covering dashboard flows. |
| `frontend` | `pnpm --filter ./frontend lint` | ESLint + Prettier conformance. |
| `docs` | `pnpm -F docs build` | Validates Markdown, links, and search index generation. |

## Hardhat structure

- **ABI specs** (`*.abi.spec.ts`) — Assert the presence of functions/events to prevent accidental ABI drift.
- **Security tests** (`security/*.test.ts`) — Validate MEV protection, reentrancy guards, and DoS mitigations.
- **Integration tests** (`integration/EndToEnd.test.ts`) — Simulate user journeys using fixtures.
- **Helpers** (`helpers/*.ts`) — Provide event parsing, artifact loading, and deterministic addresses.

### Contract test commands

- `pnpm --filter ./contracts test` — run the fast regression suite (unit, ABI, and security specs). Alias: `pnpm contracts:test`.
- ``RUN_DCA_BEHAVIOR_TESTS=true pnpm --filter ./contracts test test/system.behavior.spec.ts`` — execute the full system behaviour flow (deploys UUPS stack, performs BUY/SELL cycles).
- ``RUN_DCA_BEHAVIOR_TESTS=true pnpm --filter ./contracts test test/integration/**/*.test.ts`` — run integration and end-to-end journeys.
- `pnpm --filter ./contracts test:gas` — produce a Hardhat gas report for hot paths.
- `pnpm --filter ./contracts test:coverage` — generate Solidity coverage (output in `contracts/coverage/`).

Setting `RUN_DCA_BEHAVIOR_TESTS=true` unlocks longer-running suites that perform full deployments. Leave it unset for quick iteration.

### Running selective suites

```bash
# Target a single file
pnpm --filter ./contracts test test/unit/core/DcaManager.test.ts

# Run only security hardening suites
pnpm --filter ./contracts test test/security/**/*.test.ts
```

## Writing new tests

1. Extend fixtures in `contracts/test/fixtures/deployments.ts` if you need new deployment combinations.  
2. Use chai helpers from `helpers/artifacts.ts` to enforce ABI expectations.  
3. Mirror guard logic when adding new failure modes—emit descriptive skip reasons and assert them in tests.  
4. Update `test/TEST_SUMMARY.md` with a concise description of new scenarios.

## Gas tracking

- Add gas snapshot checks for hot paths using Hardhat's `metrics` plugin (if enabled) or by logging execution gas in tests.  
- Regression thresholds are stored in `test/COVERAGE_CHECKLIST.md`. Update them when legitimate increases occur.

## Frontend tests

- Focus on flows: create position, pause/resume, withdraw.  
- Mock viem responses to cover error states (price deviation, gas cap).  
- Keep component snapshots aligned with docs examples to prevent UI regressions.

## Docs validation

- `pnpm -F docs lint` (via ESLint, optional) and `pnpm -F docs build` ensure navigation and search metadata stay intact.  
- Use Markdown link checking before releasing to avoid broken references.

## Continual verification

- Every PR should link to the test commands executed locally.  
- CI runs the same commands and blocks merges on failure.  
- Major protocol upgrades require an external audit sign-off; store reports under `contracts/test/SECURITY_AUDIT_REPORT.md`.
