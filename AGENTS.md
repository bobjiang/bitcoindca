
# AGENTS.md — Working Rules for Code Agents (Claude/ChatGPT/Cursor) in `bitcoindca`

This document tells **AI code agents** exactly how to work in this repository without breaking things. It merges and normalizes guidance from `CLAUDE.md` and `architecture.md` so you don’t have to cross‑reference multiple files.

> **Scope of the project (essentials)**  
> - **What:** Non‑custodial automated **Dollar Cost Averaging** for **WBTC/ETH** using stablecoins (USDC default).  
> - **Venues:** AUTO routing across **Uniswap v3 ↔ CoW Protocol ↔ 1inch**, with **MEV protection** (private tx first).  
> - **Automation:** **Chainlink Automation** primary, **Gelato** fallback; optional public execution with tip after a grace window.  
> - **Security posture:** Long **TWAP**, **multi‑oracle** checks, strict slippage, circuit breakers, position/volume limits.  
> - **Core contracts:** `DcaManager (UUPS)`, `PositionNFT (ERC-721)`, `Executor`, router adapters (`UniV3Adapter`, `CowAdapter`, `OneInchAdapter`), `PriceOracle`, `Treasury`.
> - **Smart Contract:** try your best to re-use the audited openzepplin smart contract library, referring to https://github.com/OpenZeppelin/openzeppelin-contracts

If your change touches any on‑chain logic, **read** `/architecture.md` before coding. If your change modifies developer workflows, **update this file as well**.

## Coding rules

- all the solidity codes are required to reviewed by following the file `/contracts/security/Contract-Code-Review.md`
- the solidity codes must follow the existing test suits `/contracts/test/`
- any code changes are required to documentate, please update `./docs/` 
- if any new tests are required to add, change the test suits `/contracts/test/`

---

## 1) Repository Map & Ownership

- Monorepo managed by **pnpm workspaces**. Primary packages:
  - `contracts/` — Solidity sources, deployment scripts, ABIs, type bindings.
  - `frontend/` — Next.js app (RainbowKit/wagmi), Safe App mode, basic dashboard & position management.
  - `docs/` — living specs: `architecture.md` (system architecture), `user-flow.md` (flows), and this `AGENTS.md`.

**Do not** invent new top‑level packages. If you must, open an RFC in `/docs/rfcs/` first.

---

## 2) Commands You Can Safely Run

From repo root:

Note: if you need to test the behavior of smart contract, remember to set the env 
`RUN_DCA_BEHAVIOR_TESTS=true`

```bash
pnpm install               # install workspace deps
pnpm -F contracts build    # compile solidity
pnpm -F contracts test     # run solidity tests
pnpm -F contracts lint     # solhint/format checks

pnpm -F frontend dev       # run Next.js dev server
pnpm -F frontend test      # run UI tests
pnpm -F frontend lint      # eslint/prettier

pnpm format                # repo-wide formatting
```

> If a script name differs in `package.json`, prefer the existing one and **do not** rename without updating this file and CI.

---

## 3) Clean ABI Rules (🚫 no breakage)

When editing Solidity, adhere to **Clean ABI** constraints:

- **No function overloading** in public/external interfaces.
- Use **explicit types** (`uint256` not `uint`), **named returns** are okay but keep them minimal.
- **Events:** include `indexed` fields for critical selectors (position id, owner, venue).
- Stable **error selectors**: prefer `custom errors` (`error NotOwner();`) over string reverts.
- Avoid complex structs in external interfaces unless absolutely necessary; prefer simple arguments and **view getters**.
- If you must change an interface, **bump minor version**, regenerate ABIs/types, **update tests and docs**.

---

## 4) Contract Architecture (what to change where)

- **`DcaManager (UUPS)`** — creates/updates positions, tracks internal balances, checks limits/circuit breakers, authorizes executors/routers.  
  Touch this for **position lifecycle** (create, pause, resume, cancel, withdraw, emergency‑withdraw), **limits**, **slippage**, **guards**.
- **`PositionNFT (ERC‑721)`** — ownership token; metadata reads from separate upgradable storage to avoid logic conflicts.
- **`Executor`** — keeper entrypoint; enforces guards (TWAP/multi‑oracle/slippage/gas caps), selects route, executes swap, updates accounting, schedules `nextExecAt`. **All externals are nonReentrant.**
- **Router Adapters** — `UniV3Adapter`, `CowAdapter` (partial fills allowed), `OneInchAdapter`. Keep each adapter small, stateless, and audit‑friendly.
- **`PriceOracle`** — wraps Chainlink feeds (BTC/USD, ETH/USD, USDC/USD, WBTC/BTC) + UniV3 TWAP utilities.
- **`Treasury`** — fee sink (2/3 multisig & timelock). Only fee flows & withdrawals live here.

> **Never** mix concerns: don’t put routing in `DcaManager`, don’t add execution logic in `PositionNFT`, etc.

---

## 5) Security Invariants You Must Preserve

- **TWAP**: default `twapWindow` ≥ 3600s; compare execution px vs TWAP and vs Chainlink; **reject** if deviation > `maxPriceDeviationBps` (default 100 = 1%).
- **Slippage**: per‑position `slippageBps` (default 50 = 0.5%); clamp at manager‑level max.
- **Depeg guard**: for quote stables (e.g., USDC), ensure USD peg within bound before BUY orders.
- **MEV**: prefer **private tx**; on fallback to public, tighten slippage and record venue/mode.
- **Gas caps**: deny execution if `block.basefee` or priority fee exceed position caps (if set).
- **System limits**: `maxPositionsPerUser`, `maxGlobalPositions`, `minPositionSizeUsd`. Deny creates/execs when breached.
- **Reentrancy/authorization**: every external entrypoint in `Executor` and mutation in `DcaManager` is **nonReentrant** and gated (owner/role checks).

If your patch could violate any of the above, stop and open a security review PR.

---

## 6) User Flows (contract responsibilities)

- **Create Position**: direction (BUY/SELL), amount per period, frequency (daily/weekly/monthly), `startAt`/`endAt`, guards (`slippageBps`, `priceCapUsd` or `priceFloorUsd`, depeg), venue (AUTO/UNIV3_ONLY/COW_ONLY/AGGREGATOR), MEV mode (PRIVATE/PUBLIC), optional fee caps.  
- **Manage Position**: deposit/withdraw (idle balances & fills), pause/resume, modify (safe fields only: slippage/venue/gas caps/guards/beneficiary), cancel, emergency withdraw (time‑delayed).
- **Execution**: keeper calls `Executor.execute(positionId)` → validates guards → routes swap → updates balances → schedules `nextExecAt`.

Keep these flows aligned with `/architecture.md` and `/docs/user-flow.md`.

---

## 7) Frontend Expectations (don’t break UX contracts)

- Use **wagmi/RainbowKit** for wallet UX; Safe App mode supported.
- Display **oracle vs TWAP vs execution** price and deviations.
- MEV mode indicator (Private/Public) + venue chosen.
- Position table fields must include: id, owner, isBuy, quote, freq, amountPerPeriod, `nextExecAt`, guards, balances, status (active/paused/cancelled).
- If you alter return shapes in read methods or events, **update the frontend hooks and type bindings**.

---

## 8) Testing Policy

- **Contracts**: add unit tests for every guard and edge case; add **fork tests** for routing against mainnet liquidity; include reorg/partial‑fill/timeout scenarios.  
- **Gas**: track gas snapshots for hot paths; fail tests if regressions exceed threshold.  
- **Frontend**: add tests for critical flows (create, pause/resume, withdraw).  
- **Oracles**: simulate stale feeds, out‑of‑bounds depeg, and TWAP spikes.  
- **Automation**: simulate keeper cadence across daily/weekly/monthly with skipped blocks and fee spikes.

> If you change a public/external function, **add/adjust tests in the same PR**.

---

## 9) How to Propose Changes (for agents)

1. **Read** `/architecture.md` and confirm the change belongs in the target module.  
2. **Minimal diff**: prefer additive changes; don’t rename files/identifiers unless necessary.  
3. **Run** the relevant package scripts locally (see §2).  
4. **Update** ABI/types and the docs:
   - `contracts/` ABI changes → regenerate type bindings; update `/docs/architecture.md` and `/docs/user-flow.md` if behavior changes.
   - Add or update `CHANGELOG.md` with a brief bullet under “Unreleased”.
5. **Security checklist**: confirm invariants in §5 still hold; mention them in PR description.
6. **Link** to tests covering the change.

---

## 10) File‑level Rules for Agents

- **You MAY edit**
  - `contracts/*` Solidity, deployment scripts, ABIs, typechain
  - `frontend/*` pages/components/hooks
  - `docs/*` including this file and `architecture.md`
  - CI configs, lint/format configs

- **You MUST NOT edit**
  - License headers, audit report snapshots, or historical migrations
  - Git history (no squashing outside release process)
  - Secrets or environment files committed by mistake (report; do not propagate)

- **When in doubt:** open a minimal PR + RFC in `/docs/rfcs/`.

---

## 11) Glossary of Key Fields (Position storage)

```
struct Position {
  address owner;
  address beneficiary;
  address quote;            // e.g., USDC
  bool    isBuy;
  uint16  freq;             // 0=daily,1=weekly,2=monthly
  uint16  venue;            // 0=AUTO,1=UNIV3_ONLY,2=COW_ONLY,3=AGGREGATOR
  uint16  slippageBps;      // default 50 (0.5%)
  uint32  twapWindow;       // default 3600 (1h)
  uint16  maxPriceDeviationBps; // vs oracle/TWAP, default 100 (1%)
  uint64  nextExecAt;       // UTC
  uint64  startAt;          // immutable
  uint64  endAt;            // 0 if none
  uint32  periodsExec;
  uint128 amountPerPeriod;  // BUY: quote; SELL: WBTC
  uint128 priceFloorUsd;    // SELL guard; 0 none
  uint128 priceCapUsd;      // BUY guard; 0 none
  bool    paused;
  uint64  maxBaseFeeWei;    // optional
  uint64  maxPriorityFeeWei;// optional
}
mapping(uint256 => uint256) quoteBal;
mapping(uint256 => uint256) baseBal;
```

> System limits: `maxPositionsPerUser`, `maxGlobalPositions`, `minPositionSizeUsd` (enforce via oracle).

---

## 12) Prompts You Can Use (for agent tools)

- “**Add a `maxPriceDeviationBps` check to Executor before routing; fail if delta > bound; add tests for 0.5% and 2%.**”  
- “**Expose a view on DcaManager to return a summarized `PositionView` for table rendering; do not change storage.**”  
- “**Add CoW partial‑fill handling to CowAdapter and reflect fills in accounting; include fork test.**”  
- “**Add Safe App guard: reject `createPosition` when msg.sender is not the safe owner in safe mode.**”

Keep prompts tightly scoped and reference §/file paths.

---

## 13) Release Hygiene

- Tag releases with `contracts@vX.Y.Z` and `frontend@vX.Y.Z` when either package has user‑visible changes.
- Keep ABIs and type bindings in sync.
- Update `architecture.md` diagrams/sections when flows or invariants change.
- Post a short migration note if any addresses or initializers change.

---

**Last updated:** sync’d with `CLAUDE.md` & `architecture.md` (v0.3 requirements).
