---
title: Create a Position
sidebar_label: Create a Position
description: Step-by-step instructions for creating and funding a new BitcoinDCA strategy from the web app or Safe App.
---

# Create a Position

This guide walks end-users through the full creation flow for a recurring DCA strategy. Screens and terminology match the frontend application (`frontend` workspace) and Safe App mode.

## 1. Connect your wallet

- Open the BitcoinDCA dashboard and connect with RainbowKit (MetaMask, Rabby, WalletConnect, Ledger, or Safe).
- If you plan to act through a Safe, ensure the Safe owner approvals are configured. Safe mode enforces additional checks (see [`frontend` Safe guard](../developer/integration-guide.md#safe-app-considerations)).

## 2. Choose strategy direction

- **Buy** — accumulate WBTC or ETH using USDC. You should hold USDC before funding.  
- **Sell** — unwind WBTC into USDC. The base asset balance will be debited over time.

## 3. Configure schedule

- **Amount per period** — Denominated in USDC for buys, or WBTC/ETH for sells.
- **Frequency** — Daily, weekly, or monthly. Internally encoded as 0/1/2.
- **Start time** — Optional delay before the first execution. Useful for aligning with salary inflows or market windows.
- **End time** — Optional timestamp to auto-stop the position.
- **Max investment amount (optional)** - The lump sum for the DCA position.

## 4. Set safeguards

- **Slippage tolerance** (default 0.5%). Lower values = stricter execution, higher chance of skips.
- **Max price deviation** (default 1%). Restricts divergence from Chainlink/TWAP.
- **TWAP window** (default 1 hour). Increase if you want smoother pricing in volatile periods.
- **Price cap/floor** — Hard USD guard rails.
- **MEV mode** — Private (Flashbots/CoW) or Public (shorter grace period, reduced slippage).
- **Venue** — Auto routing or force a specific DEX (Uniswap v3, CoW, 1inch).
- **Gas caps** — Optional base fee / priority fee limits.

## 5. Review limits

Before submitting, confirm you are within system constraints:

- `minPositionSizeUsd` (e.g. $100) — enforced by Chainlink price feeds.
- `maxPositionsPerUser` — prevents spam.
- `maxGlobalPositions` — ensures keepers can keep up.

If the manager rejects the transaction, check `ExecutionSkipped` reasons or consult the [Troubleshooting](../troubleshooting/troubleshooting.md) page.

## 6. Submit the transaction

- Confirm `createPosition` in your wallet.
- Upon success, you receive a `PositionNFT`. In Safe mode, the transaction requires the configured number of signatures.
- The UI shows the newly assigned `positionId` and `nextExecAt`.

## 7. Fund the position

- Click **Deposit** and choose the asset matching your strategy direction.
- The app calls `deposit(positionId, token, amount)` which credits the manager’s balance mappings.
- Funding requirements are documented in `contracts/test/system.behavior.spec.ts`, ensuring executions fail gracefully if funds are insufficient.

## 8. Verify readiness

- The dashboard should display **Status: Active**.
- `nextExecAt` is in the future, and `Eligible` status shows **Yes** when the time window arrives.
- Inspect the activity feed for the `PositionCreated` and `Deposited` events with the expected payload.

Your strategy will now execute automatically. Continue to [Manage Positions](./manage-balances.md) for ongoing operations.
