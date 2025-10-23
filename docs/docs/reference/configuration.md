---
title: Configuration Matrix
sidebar_label: Configuration
description: System-wide and per-position configuration values with defaults, bounds, and governance responsibilities.
---

# Configuration Matrix

This matrix documents protocol-wide settings alongside position-level defaults. Governance changes should keep this page up to date.

## Protocol constants

| Parameter | Default | Bounds | Description | Source |
| --- | --- | --- | --- | --- |
| `protocolFeeBps` | 20 bps | 10 – 30 bps | Fee charged on successful executions, routed to Treasury. | `ProtocolConfig` |
| `executionFeeFixedWei` | 0.0005 ETH | Governance defined | Flat keeper incentive for public executions. | `ProtocolConfig` |
| `gasPremiumBps` | 100 bps | Governance defined | Extra gas incentive for private keepers. | `ProtocolConfig` |
| `feeCollector` | Treasury multisig | — | Address receiving aggregated fees. | `ProtocolConfig` |
| `maxPositionsPerUser` | 10 | 1 – 20 | Prevents spam and keeps keeper load manageable. | `CircuitBreakerConfig` |
| `maxGlobalPositions` | 10,000 | Governance defined | Hard cap on concurrent strategies. | `CircuitBreakerConfig` |
| `minPositionSizeUsd` | $100 | $50 – $5,000 | Minimum USD value at creation/funding. | `CircuitBreakerConfig` |
| `executionGracePeriodSeconds` | 21,600s (6h) | 1h – 12h | Delay before public executions are allowed. | `frontend/lib/protocol.ts` |

## Position defaults

| Field | Default | Notes |
| --- | --- | --- |
| `slippageBps` | 50 (0.5%) | clamped by `maxSlippageBps` (1,000). |
| `maxPriceDeviationBps` | 100 (1%) | Lowered automatically for public execution. |
| `twapWindow` | 3,600 seconds | Must be ≥ 600 seconds. |
| `priceCapUsd` / `priceFloorUsd` | 0 (disabled) | Optional guard rails. |
| `venue` | AUTO | Use manual venues for deterministic routing. |
| `mevMode` | PRIVATE | Fallback to PUBLIC only when necessary. |
| `maxBaseFeeWei` / `maxPriorityFeeWei` | 0 (unbounded) | Set when gas volatility is a concern. |

The defaults match `PROTOCOL_CONSTANTS` exported from `frontend/lib/protocol.ts` and validated via tests.

## Keeper registries

| Network | Chainlink Registrar | Gelato Automate | Executor Address |
| --- | --- | --- | --- |
| Mainnet (prod) | `0x...` | `0x...` | `0x...` |
| Sepolia / Test | `0x...` | `0x...` | `0x...` |

> Update this table after deployments. Store canonical addresses in `contracts/utils/constants.ts`.

## Roles & governance

| Role | Holder | Responsibilities |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Multisig + timelock | Upgrades, role assignment. |
| `PAUSER_ROLE` | Multisig ops team | Pause/resume system, asset-specific pauses. |
| `TREASURER_ROLE` | Treasury multisig | Fee config, treasury withdrawals. |
| `EXECUTOR_ROLE` / `KEEPER_ROLE` | Keeper registries | Manage authorised executors. |
| `ROUTER_ADMIN_ROLE` | Protocol engineering | Approve adapters, update routing defaults. |
| `ORACLE_ADMIN_ROLE` | Oracle ops | Update Chainlink feeds, TWAP settings. |
| `EMERGENCY_ROLE` | Security council | Trigger emergency withdraw timers. |

## Environment variables

Populate deployment and keeper scripts with the following:

| Variable | Description |
| --- | --- |
| `RPC_URL` | JSON-RPC endpoint (Alchemy/Infura). |
| `CHAINLINK_REGISTRAR` | Chainlink Automation registrar address. |
| `GELATO_AUTOMATE` | Gelato Automate address. |
| `FLASHBOTS_RELAY` | Flashbots RPC endpoint for private tx. |
| `EXEC_PRIVATE` | Toggle private Flashbots routing for scripts and API defaults (`true` / `false`). |
| `FLASHBOTS_AUTH_KEY` | Optional signer used for `X-Flashbots-Signature` headers. |
| `NEXT_PUBLIC_EXEC_PRIVATE` | Frontend default for the execution toggle (overridable in dev mode). |
| `NEXT_PUBLIC_FLASHBOTS_RELAY` | Client-side relay override when surface needs to surface the endpoint. |
| `NEXT_PUBLIC_EXECUTOR_ADDRESS` | Executor contract used by the dashboard/API for manual executions. |
| `EXECUTOR_PRIVATE_KEY` | Keeper signing key (store securely). |
| `SAFE_ADDRESS` | Multisig address for admin operations. |

## Post-change checklist

1. Update `ProtocolConfig` / `CircuitBreakerConfig` on-chain via timelock.  
2. Reflect new values in `frontend/lib/protocol.ts`.  
3. Regenerate TypeScript types (`pnpm --filter ./contracts typechain`).  
4. Rebuild docs (`pnpm --filter docs build`) and ensure this page mirrors on-chain settings.  
5. Notify keepers and users via Discord/EPNS.
