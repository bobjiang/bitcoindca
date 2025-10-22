---
title: FAQ
sidebar_label: FAQ
description: Frequently asked questions about DCA Crypto for both end-users and developers.
---

# Frequently Asked Questions

## General

**Is DCA Crypto custodial?**  
No. Funds stay in smart contracts controlled by your wallet or Safe. You can withdraw or trigger emergency exits at any time.

**Which assets are supported?**  
USDC is the default quote asset. Base assets include WBTC and ETH. Additional tokens require governance approval and updated oracles.

**How often can I execute?**  
Daily, weekly, or monthly by default. Advanced users can request custom frequencies through governance and keeper updates.

**Do I need to keep my browser open?**  
No. Chainlink and Gelato keepers run autonomously. You only need to interact when creating, modifying, or cancelling positions.

## Pricing & guards

**What happens if the price suddenly spikes?**  
If execution price deviates beyond `maxPriceDeviationBps` or the TWAP window fails validation, the transaction is skipped with reason `PRICE_DEVIATION`.

**Does the protocol protect against USDC depegging?**  
Yes. The executor checks Chainlink’s USDC/USD feed. If USDC trades outside the configured range, executions halt (`DEPEG` reason).

**Can I customise slippage per position?**  
Yes, within the system-wide max (`maxSlippageBps`). Modify the position from the dashboard or call `modify`.

## Fees

**What fees apply?**  
Protocol fee (basis points) plus any fixed execution fee set in `ProtocolConfig`. Public executors may receive a capped tip. Fees flow to the Treasury.

**Are there gas refunds?**  
Gas is paid by the executing keeper. For public executions, the protocol adds the fixed execution fee to cover costs.

## Operations

**How do I derive cost basis?**  
Subscribe to `PositionExecuted` and reconstruct amounts from the event. The docs provide sample listeners in [Events & Telemetry](../reference/events.md).

**Can I move my PositionNFT to another wallet?**  
Yes, but the new owner assumes control of modifications and withdrawals. Ensure the beneficiary is updated if needed.

**What if my keeper fails to execute?**  
Check skip reasons and ensure deposits cover future periods. Public execution activates after the grace window to provide a manual fallback.

## Security & upgrades

**Are contracts upgradeable?**  
Yes via UUPS proxies. Upgrades go through multisig + timelock. Tests in `system.behavior.spec.ts` prevent re-initialisation.

**Where can I see audits?**  
See `contracts/test/SECURITY_AUDIT_REPORT.md` for the latest reports. Release PRs link to audit coversheets.

**How is MEV handled?**  
Private execution routes via Flashbots / CoW. Public mode halves slippage limits and emits telemetry, so ops can flag degraded conditions.

## Getting help

- Join the Discord (`https://discord.gg/bitcoindca`) in the #support channel.
- File GitHub issues for bugs.
- For security disclosures, email security@bitcoindca.xyz and follow the responsible disclosure policy.
