---
title: Getting Started
sidebar_label: Getting Started
description: Set up BitcoinDCA as an end-user or developer, including wallet requirements, environment configuration, and first-time deployment steps.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Getting Started

Use this guide to configure your wallet, fund the protocol, or bootstrap a development environment.

## Prerequisites

- Ethereum wallet compatible with EIP-1559 (MetaMask, Rabby, Rainbow, or Safe Multisig).  
- Stablecoins (USDC) or WBTC/ETH depending on whether you plan to **buy** or **sell**.
- Familiarity with gas fees and the Ethereum mainnet (or the designated deployment network).
- Node.js 20+ and `pnpm` v8+ for development tasks.

## Environment selection

BitcoinDCA supports the following environments:

- **Mainnet** — production execution with live routing.  
- **Testnets** — fork-based testing driven by the Hardhat suite (`pnpm -F contracts test`).  
- **Local devnet** — run Hardhat node or Anvil for integration testing.

## Quickstart

<Tabs groupId="audience">
  <TabItem value="user" label="End-Users">

1. **Connect wallet** in the frontend application or Safe App.  
2. **Create a position** by choosing the quote asset (USDC), target asset (WBTC or ETH), frequency (daily/weekly/monthly), amount per period and max investment amount (optional).  
3. **Configure safeguards**:  
   - slippage tolerance (default 0.5%)  
   - TWAP window (default 1 hour)  
   - price cap/floor (optional hard bounds)  
   - MEV mode (Private recommended)  
4. **Fund the position**: deposit USDC (for buys) or WBTC/ETH (for sells). This is to deposit "max investment amount" or "max amount of assets in the wallet". 
5. **Monitor execution**: the dashboard displays `nextExecAt`, last execution price, guard status, and balances.  
6. **Adjust or pause** if your strategy or market conditions change. Resuming auto-updates `nextExecAt`.
7. **Manage a position**: change the frequency (daily/weekly/monthly), amount per period and max investment amount (optional) for an existing position.
8. **Cancel a position**: Closes the position and refunds balances to the beneficiary.

Callouts inside the UI surface guard failures (`PRICE_DEVIATION`, `GAS_CAP`, `DEPEG`) based on the executor events captured in the integration tests (`contracts/test/system.behavior.spec.ts`).

  </TabItem>
  <TabItem value="developer" label="Developers">

1. **Clone and install**

   ```bash
   git clone https://github.com/bobjiang/bitcoindca.git
   cd bitcoindca
   pnpm install
   ```

2. **Compile and test contracts**

   ```bash
   pnpm -F contracts build
   pnpm -F contracts test
   ```

   The behaviour and guard coverage tests (e.g. `contracts/test/system.behavior.spec.ts`) validate the execution pipeline. Use them as executable documentation when extending features.

3. **Run the frontend or docs**

   ```bash
   pnpm -F frontend dev     # user dashboard
   pnpm -F docs start       # documentation site
   ```

4. **Deploy to a fork or devnet**

   Use the deployment scripts under `contracts/scripts`. Ensure Chainlink Automation and Gelato registry addresses are configured in your environment variables before broadcasting.

5. **Generate TypeScript bindings**

   ```bash
   pnpm -F contracts typechain
   ```

   Bindings are used by both the frontend and the examples in this documentation.

  </TabItem>
</Tabs>

## Checklist before first execution

- ✅ `createPosition` transaction confirmed on-chain.  
- ✅ Minimum deposit met (`minPositionSizeUsd` enforced by the manager).  
- ✅ `nextExecAt` set in the future (position respects `startAt`).  
- ✅ Oracle feeds for USDC/BTC/ETH/WBTC are healthy (staleness < `maxStaleTime`).  
- ✅ Keeper registry (Chainlink or Gelato) has the executor address whitelisted.  
- ✅ Executor roles (`KEEPER_ROLE`, `EXECUTOR_ROLE`) granted via multisig.

## Next Steps

- Read the [Core Concepts](../core-concepts/positions.md) to understand how positions, balances, and guards are modelled.
- Walk through the [User Guides](../user-guides/create-position.md) for detailed operational flows.
- Jump to the [Developer Guides](../developer/architecture.md) for architectural diagrams and integration patterns.
