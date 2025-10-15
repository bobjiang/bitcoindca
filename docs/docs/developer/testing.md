---
title: Testing Playbooks
sidebar_label: Testing
description: Guidance on running, extending, and interpreting the BitcoinDCA smart contract and frontend test suites.
---

# Testing Playbooks

BitcoinDCA enforces strict testing requirements for every public/external change. Follow this guide to run existing suites and expand coverage.

## Test suites

| Package | Command | Purpose |
| --- | --- | --- |
| `contracts` | `pnpm -F contracts test` | Hardhat-based unit, integration, and security tests. |
| `contracts` | `pnpm -F contracts build` | Solidity compilation and ABI generation. |
| `frontend` | `pnpm -F frontend test` | Component and hook tests covering dashboard flows. |
| `frontend` | `pnpm -F frontend lint` | ESLint + Prettier conformance. |
| `docs` | `pnpm -F docs build` | Validates Markdown, links, and search index generation. |

## Hardhat structure

- **ABI specs** (`*.abi.spec.ts`) — Assert the presence of functions/events to prevent accidental ABI drift.
- **Security tests** (`security/*.test.ts`) — Validate MEV protection, reentrancy guards, and DoS mitigations.
- **Integration tests** (`integration/EndToEnd.test.ts`) — Simulate user journeys using fixtures.
- **Helpers** (`helpers/*.ts`) — Provide event parsing, artifact loading, and deterministic addresses.

### Running selective suites

```bash
RUN_DCA_BEHAVIOR_TESTS=true pnpm -F contracts test test/system.behavior.spec.ts
```

Setting `RUN_DCA_BEHAVIOR_TESTS=true` unlocks longer-running behaviour tests that deploy full UUPS stacks (see `system.behavior.spec.ts` logic).

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
