---
title: Troubleshooting Runbook
sidebar_label: Troubleshooting
description: Operational checklist for diagnosing and resolving common DCA Crypto incidents.
---

# Troubleshooting Runbook

Use this runbook when automation or execution issues arise. It complements the FAQ with deeper operational steps.

## 1. Execution skipped

1. **Identify reason**  
   - Check `ExecutionSkipped(positionId, reason)` event.  
   - Map reason to guard using `frontend/lib/protocol.ts` `EXECUTION_REASONS`.
2. **Action matrix**

| Reason | Likely cause | Mitigation |
| --- | --- | --- |
| `PRICE_DEVIATION` | Oracle vs TWAP mismatch | Verify Chainlink feeds (`PriceOracle.getQuoteUsd`), adjust `maxPriceDeviationBps`, or wait for volatility to subside. |
| `DEPEG` | Stablecoin price off $1 | Pause positions, notify users, allow emergency withdraw if persistent. |
| `GAS_CAP` | Base/priority fee > configured caps | Increase caps or wait for cheaper block conditions. |
| `PAUSED` | Position or system paused | Resume once safe. |
| `INSUFFICIENT_FUNDS` | Deposit too low | Top up via `deposit`. |

Refer to `contracts/test/security/MEVProtection.test.ts` and `DOSProtection.test.ts` to understand guard triggers.

## 2. Keeper not executing

1. Check Chainlink/Gelato dashboards for task status.  
2. Ensure `KEEPER_ROLE` still covers registry addresses (`executor.hasRole`).  
3. Confirm grace period not exceeded. If exceeded, encourage public execution or run a manual keeper script:

```bash
pnpm --filter ./contracts ts-node scripts/manualExecute.ts --position 42
```

4. Review recent contract upgrades or config changes that may have invalidated automation.

## 3. Oracle issues

1. Inspect `PriceOracle.getQuoteUsd` timestamps for staleness.  
2. Compare TWAP data from `getTwap`.  
3. If Chainlink feed is stale, trigger `CircuitBreakerTriggered` via `PAUSER_ROLE` and investigate provider status.

## 4. Routing failures

- For CoW, ensure solver endpoints are reachable and the adapter has approval to spend funds.  
- For Uniswap v3, check pool liquidity and fee tier availability.  
- For 1inch, validate aggregator payload generation.  
- Use `simulate(positionId)` to reproduce failing routes with trace logs.

## 5. Emergency withdrawal requests

1. User initiates `emergencyWithdraw`. Record timestamp.  
2. After the delay, assist with `completeEmergencyWithdraw`.  
3. Audit balances before and after to confirm invariants.  
4. Document the incident in `docs/user-flow.md` if systemic.

## 6. Frontend anomalies

- Run `pnpm --filter ./frontend lint` and `pnpm --filter ./frontend test`.  
- Clear local storage/session caches (RainbowKit).  
- Validate environment variables (`NEXT_PUBLIC_DCA_MANAGER`, etc.).  
- Compare API responses with on-chain data via `getPosition` to identify caching issues.

## 7. Documentation updates

When new incident types emerge:

1. Add reason codes to `frontend/lib/protocol.ts`.  
2. Update this runbook and relevant guides.  
3. Regenerate docs (`pnpm --filter docs build`) and redeploy.

## 8. Communication checklist

- Notify users via Discord/EPNS.  
- Pin skip reasons and mitigations to dashboard banners.  
- For prolonged incidents, activate maintenance mode and block new positions until resolved.
