# DCA Crypto MVP Implementation Guide

## Quick Reference: Files to Remove/Simplify

### DELETE Entirely (Safe for MVP)
```
- OneInchAdapter.sol (295 lines)
- CoWAdapter.sol (320 lines)  
- PositionStorage.sol (174 lines)
- MockCowSettlement.sol (test file)
- Mock1inchRouter.sol (test file)
```

**Reason:** Features deferred to M1-M2. Core MVP works without them.

---

### SIMPLIFY (Keep Core, Remove Extras)

#### 1. DcaManager.sol - Remove Incomplete Features

**REMOVE these fields (lines 217-220):**
```solidity
// DELETE - circuit breakers not enforced
uint256 public dailyVolumeLimitUsd;
uint16 public maxPriceMovementBps;

// DELETE - Gelato fallback not implemented  
address public gelatoKeeperRegistry;

// DELETE - emergency delay over-engineered
uint64 public emergencyDelay;

// DELETE - unused in MVP
mapping(address => uint256[]) private _ownerPositions;
mapping(address => mapping(uint256 => uint256)) private _ownerPositionIndex;
```

**REMOVE these functions:**
```solidity
// Line 519-564: emergencyWithdraw() - too complex
// Delete entirely. Regular withdraw() handles all cases.

// Line 748-750: getAllowedBaseTokens() - for subgraph only
// Move to off-chain query if needed

// Line 766-772: setCircuitBreakerConfig() - not enforced
// Delete - use pauseAll() instead

// Line 774-781: setKeeperRegistry() - Gelato stub
// Delete - only Chainlink needed, registered elsewhere

// Line 848-854: reconcileActivePositions() - admin cleanup
// Delete - shouldn't drift with proper state management
```

**SIMPLIFY these functions:**
```solidity
// Line 271-277: Reduce from 12 role grants to 4:
_grantRole(Roles.DEFAULT_ADMIN, msg.sender);
_grantRole(Roles.EXECUTOR, msg.sender);
// Delete: PAUSER, ROUTER_ADMIN, ORACLE_ADMIN, TREASURER, MINTER, BURNER, etc.

// Line 713-715: Remove positionExecNonce() - unused if nonce system removed
// Or keep as deprecated stub

// Line 717-737: Simplify isPositionEligible()
// Remove balance check - redundant with executorTransferTo() validation
```

---

#### 2. Executor.sol - Remove Keeper Integration

**REMOVE these functions (lines 89, 148-154, 255-287):**
```solidity
// DELETE:
uint256 public constant PUBLIC_EXECUTION_GRACE = 6 hours;  // Line 89

function trackPosition(uint256 positionId)  // Lines 148-154
// No tracking needed for MVP - keeper calls execute() directly

function checkUpkeep(bytes calldata)  // Lines 255-267
// Remove - MVP uses manual keeper or off-chain automation

function performUpkeep(bytes calldata)  // Lines 269-274
// Remove - MVP uses manual keeper calls

function executePublic(uint256 positionId)  // Lines 276-287
// Remove - public execution adds MEV/griefing risks
```

**SIMPLIFY selectRoute() (lines 307-322):**
```solidity
// BEFORE (16 lines with AUTO routing):
function selectRoute(uint256 positionId) public view returns (uint16 venue, bytes memory routeData) {
    IDcaManager.Position memory position = dcaManager.getPosition(positionId);
    if (position.venue != 0) {
        venue = position.venue;
    } else {
        uint256 notional = _positionNotional(position);
        if (notional >= 5_000 * 1e6) {
            venue = 2; // COW
        } else {
            venue = 1; // Uni v3
        }
    }
    address adapter = routerManager.getAdapter(venue);
    routeData = abi.encode(position.quoteToken, position.baseToken, venue, adapter);
}

// AFTER (6 lines, Uni v3 only):
function selectRoute(uint256 positionId) public view returns (uint16 venue, bytes memory routeData) {
    IDcaManager.Position memory position = dcaManager.getPosition(positionId);
    venue = position.venue != 0 ? position.venue : 1; // Default to Uni v3
    address adapter = routerManager.getAdapter(venue);
    routeData = abi.encode(position.quoteToken, position.baseToken, venue, adapter);
}
```

---

#### 3. Treasury.sol - Remove Governance Layer

**CHANGE inheritance (line 18):**
```solidity
// BEFORE:
contract Treasury is TimelockController, Pausable, ReentrancyGuard {

// AFTER:
contract Treasury is Pausable, ReentrancyGuard {
```

**REMOVE from constructor (lines 56-70):**
```solidity
// DELETE TimelockController constructor call
// BEFORE:
constructor(
    uint256 minDelay,
    address[] memory proposers,
    address[] memory executors,
    address admin
) TimelockController(minDelay, proposers, executors, admin) { ... }

// AFTER:
constructor(address admin) {
    require(admin != address(0), "Invalid admin");
    _grantRole(DEFAULT_ADMIN_ROLE, admin);
}
```

**REMOVE these methods:**
```solidity
// Lines 288-316: execute() and executeBatch()
// These are for timelock governance - not needed in MVP

// Lines 137-155: calculateFees() with referrals
// Replace with:
function calculateFees(uint256 notionalUsd) 
    public pure returns (uint256 protocolFee) 
{
    return (notionalUsd * 20) / 10_000;  // 20 bps flat
}

// Lines 116-120: setCustomReferralFee()
// Delete - no referrals in MVP

// Lines 122-127: setReferralFeeOnTop()
// Delete - no referrals in MVP
```

---

#### 4. RouterManager.sol - Remove Array Tracking

**REMOVE (lines 19, 42, 88-90):**
```solidity
// DELETE this array:
uint16[] private _registeredVenues;  // Line 19

// In addRouterAdapter():
// DELETE: _registeredVenues.push(venue);  // Line 42

// DELETE this function:
function registeredVenues() external view returns (uint16[] memory list)  // Lines 88-90
// Venue list is static for MVP - hardcode or use mapping only

// DELETE:
function _removeVenue(uint16 venue) private  // Lines 92-103
// Venues aren't removed in MVP
```

**RESULT:** RouterManager becomes 30 lines (just add/update adapter mappings)

---

#### 5. PositionNFT.sol - Simplify Roles

**REMOVE MINTER/BURNER separation (line 66, 76):**
```solidity
// BEFORE:
function mint(address to, uint256 tokenId) external onlyRole(Roles.MINTER)
function burn(uint256 tokenId) external onlyRole(Roles.BURNER)

// AFTER:
function mint(address to, uint256 tokenId) external onlyRole(Roles.DEFAULT_ADMIN)
function burn(uint256 tokenId) external onlyRole(Roles.DEFAULT_ADMIN)
```

---

#### 6. PriceOracle.sol - Keep As-Is

✅ No changes needed. This is well-designed.

---

#### 7. Roles.sol - Consolidate to 4 Roles

**DELETE (lines 7-16):**
```solidity
// Keep ONLY these 4:
bytes32 internal constant DEFAULT_ADMIN = 0x0000...;
bytes32 internal constant EXECUTOR = 0xd8aa...;
bytes32 internal constant KEEPER = 0xfc87...;
bytes32 internal constant PAUSER = 0x65d7...;

// DELETE all others:
// MINTER, BURNER, METADATA, EMERGENCY, FEE_COLLECTOR, 
// ROUTER_ADMIN, ORACLE_ADMIN, TREASURER
```

---

## Simplified Execution Flow (MVP)

```
User: createPosition()
  ↓
DcaManager: Store position + Mint NFT
  ↓
Keeper (off-chain): Call execute(positionId) after nextExecAt
  ↓
Executor._execute():
  1. Check isPositionEligible()
  2. Get oracle price (Chainlink)
  3. Validate guard checks (price, slippage)
  4. Calculate flat 20 bps fee
  5. Transfer to UniV3Adapter
  6. Swap via Uni v3
  7. Call dcaManager.onFill() with results
  8. Update nextExecAt + emit event
  ↓
Subgraph: Index events for analytics
  ↓
User: withdraw() anytime, pause() if needed
```

**No circuit breakers, no referrals, no CoW, no Chainlink Automation**

---

## Testing Implications

### Tests to REMOVE
```
- tests/unit/CoW*.spec.ts
- tests/unit/OneInch*.spec.ts
- tests/unit/Chainlink*.spec.ts
- tests/unit/emergency*.spec.ts
- tests/unit/*referral*.spec.ts
- tests/unit/*circuit*.spec.ts
- tests/unit/*nonce*.spec.ts
```

### Tests to KEEP
```
✅ tests/unit/dcaManager.spec.ts (core position lifecycle)
✅ tests/unit/executor.spec.ts (execution + guard checks)
✅ tests/unit/uniV3Adapter.spec.ts (swap only)
✅ tests/unit/treasury.spec.ts (fee collection only)
✅ tests/unit/positionNFT.spec.ts (minting/burning)
✅ tests/unit/oracle.spec.ts (price validation)
✅ tests/integration/basic-flow.spec.ts (full user journey)
```

### New Tests to ADD
```
✅ tests/unit/execution-without-nonce.spec.ts
✅ tests/unit/simple-treasury.spec.ts (no timelock)
✅ tests/integration/multi-position-execution.spec.ts
✅ tests/integration/withdrawal-paused-position.spec.ts
```

---

## Deployment Changes

### Contracts to Deploy (MVP)
```
1. PriceOracle (standalone)
2. PositionNFT (UUPS proxy)
3. DcaManager (UUPS proxy)
4. Executor (standalone, immutable)
5. UniV3Adapter (standalone)
6. RouterManager (standalone)
7. Treasury (standalone, no timelock)
```

### Removed Deployments
```
❌ PositionStorage (merge into DcaManager)
❌ CoWAdapter
❌ OneInchAdapter
❌ MockCowSettlement (test mock)
```

**Total: 7 contracts down from 10-12**

---

## Gas Optimization Summary

| Change | Gas Saved | Implementation |
|--------|-----------|-----------------|
| Remove position tracking array | 400/position | Delete _ownerPositions |
| Flat fee vs. tiered | 2,100/exec | Remove calculateFees() |
| No nonce checks | 20,000/exec | Simplify onFill() |
| No PositionStorage writes | 20,000/mutation | Merge metadata |
| No referral lookups | 5,000/exec | Remove Treasury.calculateFees() |
| **TOTAL** | **~47,500 gas/user journey** | - |

---

## Migration Path (If Deploying Live)

### Phase 0: MVP Deployment
- Deploy core 7 contracts
- No data migration (new instance)
- Set limits: maxPositions=10, minSize=$100, maxGlobal=$10k

### Phase 1: Add CoW + Chainlink (M1)
- Deploy CoWAdapter in parallel
- Deploy new Executor v2 with CoW logic
- Update RouterManager to point to CoW
- DcaManager unchanged - backward compatible

### Phase 2: Add Governance (M3)
- Deploy Treasury v2 with TimelockController
- Migrate fee collection logic
- Add referral system
- No breaking changes to user positions

---

## Security Checklist for MVP

- [ ] All reentrancy guards in place (execute, withdraw, deposit)
- [ ] No delegatecall usage
- [ ] All external calls follow checks-effects-interactions
- [ ] Chainlink oracle has 30-min staleness check
- [ ] TWAP window minimum is 300 seconds
- [ ] Price deviation maximum is 1%
- [ ] Slippage defaults to 50 bps (0.5%)
- [ ] Position balance validated before transfer
- [ ] Nonce system removed (no auth complexity)
- [ ] Emergency pause works immediately

