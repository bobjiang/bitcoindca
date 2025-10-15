---
title: Use Cases
sidebar_label: Use Cases
description: Real-world scenarios that demonstrate how BitcoinDCA delivers disciplined exposure management for individuals, treasuries, and funds.
---

# Use Cases

BitcoinDCA caters to a range of automation needs. Below are common patterns distilled from user interviews and integration partners.

## Long-term accumulation

- **Profile:** Individual stacking sats or ETH over months/years.
- **Setup:** Weekly USDC→WBTC buys with conservative slippage (0.3%), price cap at $80k.  
- **Why BitcoinDCA:** Eliminates manual trading, ensures MEV-safe execution, and keeps funds self-custodied.
- **Key guard:** TWAP deviation to avoid buying local tops after volatile moves.

## Treasury diversification

- **Profile:** DAO or corporate treasury migrating a portion of stable reserves into BTC/ETH.  
- **Setup:** Monthly USDC→WBTC buys with higher per-period size, multi-sig ownership via Safe App, beneficiary set to treasury wallet.  
- **Why BitcoinDCA:** Supports Safe workflows, circuit breakers guard against market dislocations, and the analytics surface compliance metrics.  
- **Key guard:** Per-position gas caps to avoid executing during fee spikes.

## Income smoothing

- **Profile:** Mining operation selling BTC into USDC to cover operating costs.  
- **Setup:** Daily WBTC→USDC sells scheduled after preferred payout times, MEV mode set to private to avoid sandwich risk.  
- **Why BitcoinDCA:** Converts revenue gradually, protecting against sudden price drops while maintaining precise accounting.

## Fund rebalancing

- **Profile:** Active managers rebalancing portfolios across BTC/ETH allocations without overexposure.  
- **Setup:** Combined BUY and SELL positions with staggered start times.  
- **Why BitcoinDCA:** PositionNFT ownership allows delegation to sub-custodians, while circuit breakers prevent runaway execution.

## Automated OTC

- **Profile:** OTC desk running standing orders for clients.  
- **Setup:** Private execution, bespoke frequency (e.g., twice daily using custom scheduler), watchers monitor `ExecutionSkipped` to alert human traders.  
- **Why BitcoinDCA:** Deep integration hooks (events, subgraph) and deterministic guard logic.

## Leveraging the test suite

The behaviour tests (`contracts/test/system.behavior.spec.ts`) include fixtures for each pattern:

```typescript
const createTx = await dcaManager.connect(user).createPosition({
  beneficiary: await user.getAddress(),
  quote: addresses.USDC,
  base: addresses.WBTC,
  isBuy: true,
  amountPerPeriod: ethers.parseUnits("500", TOKEN_DECIMALS.USDC),
  frequency: Frequency.WEEKLY,
  venue: Venue.AUTO,
  slippageBps: PROTOCOL_CONSTANTS.DEFAULT_SLIPPAGE_BPS,
  maxPriceDeviationBps: PROTOCOL_CONSTANTS.DEFAULT_MAX_PRICE_DEVIATION_BPS,
  twapWindow: PROTOCOL_CONSTANTS.DEFAULT_TWAP_WINDOW,
  priceCapUsd: ethers.parseUnits("80000", 8),
  priceFloorUsd: 0,
  startAt: now + 3600,
  endAt: 0,
  maxBaseFeeWei: 0,
  maxPriorityFeeWei: 0,
  metadataURI: "ipfs://strategy-metadata",
});
```

Use these fixtures as templates for scripting or automating onboarding flows.
