---
title: Security Controls
sidebar_label: Security Controls
description: Review the guardrails, circuit breakers, and operational procedures that protect BitcoinDCA users and liquidity.
---

# Security Controls

Security in BitcoinDCA is anchored around deterministic guardrails, rigorous testing, and multi-venue MEV mitigation. This page aligns with the invariants defined in `AGENTS.md` §5.

## Guard categories

### Price integrity

- **TWAP window (`twapWindow`)** — Minimum 3600 seconds. Ensures execution price tracks long-term market trends, protecting against short-lived spikes.
- **Max price deviation (`maxPriceDeviationBps`)** — Default 100 (1%). Compares execution quote to both Chainlink and Uniswap v3 TWAP references.
- **Depeg guard** — Checks quote stablecoin (USDC) price ≈ $1 before allowing BUY orders.

### Execution environment

- **Slippage (`slippageBps`)** — Per-position tolerance, capped by a manager-wide maximum.
- **Gas caps (`maxBaseFeeWei`, `maxPriorityFeeWei`)** — Prevents executions when gas spikes occur.
- **MEV posture** — Private execution modes prefer Flashbots/CoW. Public fallback halves slippage tolerance.

### System-level circuit breakers

- **Global limits** — `maxGlobalPositions`, `maxPositionsPerUser`, and `minPositionSizeUsd`.
- **Pause levers** — Role-gated `pause`/`unpause` for asset-specific incidents.
- **Emergency withdrawal** — Time-delayed exit for users if routing stacks are degraded.

## Tests covering invariants

| Test file | Focus area | Key expectations |
| --- | --- | --- |
| `contracts/test/security/Reentrancy.test.ts` | External entrypoints | Ensures `nonReentrant` guards and state snapshots prevent double spend |
| `contracts/test/security/MEVProtection.test.ts` | Routing posture | Validates private mode, price deviation checks, and skip reasons |
| `contracts/test/security/DOSProtection.test.ts` | Circuit breakers | Blocks execution when global pause or cap is active |
| `contracts/test/system.behavior.spec.ts` | End-to-end flow | Confirms execution schedule, gas caps, and guards interact correctly |
| `contracts/test/oracle.abi.spec.ts` | Oracle interface | Verifies Chainlink feed exposure to keepers and UI |

All tests can be run with `pnpm -F contracts test`. CI pipelines block merges that violate these invariants.

## Access control & roles

- `DEFAULT_ADMIN_ROLE` — Multisig / timelock with authority over upgrades and configuration.
- `PAUSER_ROLE` — Can pause/unpause manager and executor.
- `EXECUTOR_ROLE` / `KEEPER_ROLE` — Grants execution permissions to Chainlink/Gelato registries.
- `TREASURER_ROLE` — Manages treasury withdrawals and protocol fee configuration.
- `EMERGENCY_ROLE` — Triggers emergency withdrawal timers and global stop-gaps.

Roles inherit from OpenZeppelin `AccessControl` with explicit revocation flows. See `contracts/test/treasury.abi.spec.ts` for coverage.

## Upgrade safety

- Contracts follow the UUPS proxy pattern with storage separation (e.g. `PositionStorage`) to avoid layout collisions.
- Behaviour tests call `upgrades.erc1967.getImplementationAddress` to ensure proxies point to valid implementation addresses and reject re-initialisation.
- Upgrade proposals require timelock delay and are documented in `docs/architecture.md` (root repo).

## Incident response

1. **Detect** — Monitoring stack subscribes to `ExecutionSkipped`, `CircuitBreakerTriggered`, and off-chain price alerts.
2. **Diagnose** — Compare on-chain state via `getPosition` and event logs to identify the failure mode.
3. **Mitigate** — Pause affected assets or globally if necessary; notify users and keepers.
4. **Recover** — When safe, resume automation or allow users to trigger `emergencyWithdraw`.
5. **Post-mortem** — Document incident in `/docs/user-flow.md` (root) and update relevant runbooks.

Adhering to these processes keeps BitcoinDCA resilient even during market stress or infrastructure outages.
