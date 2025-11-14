# DCA Crypto MVP Action Plan

## Overview
**Current State:** ~3500 lines of contracts with advanced features
**Target MVP:** ~2800 lines with core functionality only
**Effort:** 2-3 days of targeted refactoring
**Risk:** LOW - all changes are removals/simplifications, no new code

---

## Critical Path Actions (Do First)

### Action 1: Delete 3 Complete Files
**Time: 30 minutes**

```bash
# Files to DELETE entirely:
rm contracts/contracts/execution/CoWAdapter.sol
rm contracts/contracts/execution/OneInchAdapter.sol
rm contracts/contracts/core/PositionStorage.sol

# Test files to DELETE:
rm contracts/test/unit/cowProtocol.spec.ts
rm contracts/test/unit/oneInch.spec.ts
rm contracts/test/integration/positionStorage.spec.ts
rm contracts/test/mocks/MockCowSettlement.sol
rm contracts/test/mocks/Mock1inchRouter.sol
```

**Verification:**
- [ ] Build still succeeds: `npm run build`
- [ ] Tests still run: `npm run test`
- [ ] No imports broken (router manager uses adapters dynamically)

---

### Action 2: Simplify Roles.sol
**Time: 15 minutes**

**File:** `/home/user/dca-crypto/contracts/contracts/libraries/Roles.sol`

**Changes:**
```solidity
// KEEP ONLY:
bytes32 internal constant DEFAULT_ADMIN = 0x0000000000000000000000000000000000000000000000000000000000000000;
bytes32 internal constant EXECUTOR = 0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63;
bytes32 internal constant KEEPER = 0xfc8737ab85eb45125971625a9ebdb75cc78e01d5c1fa80c4c6e5203f47bc4fab;
bytes32 internal constant PAUSER = 0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a;

// DELETE THESE LINES:
// MINTER, BURNER, METADATA, EXECUTOR, EMERGENCY, FEE_COLLECTOR, 
// ROUTER_ADMIN, ORACLE_ADMIN, TREASURER
```

**Verification:**
- [ ] grep Roles.sol to find any remaining role constants - should be 4 only
- [ ] Compile: `npx hardhat compile`

---

### Action 3: Update DcaManager.sol
**Time: 1 hour**

**Changes summary:**
```
Lines to DELETE:
- 217-220: dailyVolumeLimitUsd, maxPriceMovementBps, gelatoKeeperRegistry, emergencyDelay
- 231-238: _ownerPositions[], _ownerPositionIndex[], userPositionCount (lines 231-233 keep count only)
- 271-277: Role grants (keep only DEFAULT_ADMIN and EXECUTOR)
- 519-564: emergencyWithdraw() function entirely
- 748-750: getAllowedBaseTokens() function
- 766-772: setCircuitBreakerConfig() function
- 774-781: setKeeperRegistry() function
- 811-813: setEmergencyDelay() function
- 848-854: reconcileActivePositions() function
- 895-898: _bumpExecNonce() function and related nonce bumping calls
- 713-715: positionExecNonce() function

Lines to MODIFY:
- 179: Remove uint64 execNonce from Position struct
- 378: Remove execNonce initialization
- 655: Remove nonce check from onFill()
- 451: Remove _bumpExecNonce() call from modify()
- 470: Remove _bumpExecNonce() call from pause()
- 490: Remove _bumpExecNonce() call from resume()
- 509: Remove _bumpExecNonce() call from cancel()
- 531: Remove _bumpExecNonce() call from emergencyWithdraw()
- 556: Remove _bumpExecNonce() call from emergencyWithdraw()
- 685: Remove _bumpExecNonce() call from onFill()
```

**Detailed edits:**

```solidity
// 1. Position struct (line 166):
struct Position {
    address owner;
    address beneficiary;
    address quoteToken;
    address baseToken;
    uint128 amountPerPeriod;
    uint128 priceFloorUsd;
    uint128 priceCapUsd;
    uint64 nextExecAt;
    uint64 startAt;
    uint64 endAt;
    uint64 pausedAt;
    // DELETE: uint64 emergencyUnlockAt;  <- line 178
    // DELETE: uint64 execNonce;          <- line 179
    uint32 periodsExecuted;
    uint32 twapWindow;
    uint16 frequency;
    uint16 venue;
    uint16 slippageBps;
    uint16 maxPriceDeviationBps;
    uint64 maxBaseFeeWei;
    uint64 maxPriorityFeeWei;
    uint8 quoteDecimals;
    uint8 baseDecimals;
    bool isBuy;
    bool paused;
    bool canceled;
    bool mevProtection;
    bool exists;
}

// 2. Storage (line 228):
// DELETE: dailyVolumeLimitUsd (line 217)
// DELETE: maxPriceMovementBps (line 218)
// DELETE: gelatoKeeperRegistry (line 226)
// DELETE: emergencyDelay (line 220)
// DELETE: _ownerPositions[] (line 231)
// DELETE: _ownerPositionIndex (line 232)

// Keep only:
mapping(uint256 => uint256) private _quoteBalances;
mapping(uint256 => uint256) private _baseBalances;
// KEEP but simplify - remove uses:
mapping(address => uint256) public userPositionCount;
mapping(address => bool) public allowedQuoteTokens;
mapping(address => bool) public allowedBaseTokens;

// 3. Initialize (lines 271-277):
_grantRole(Roles.DEFAULT_ADMIN, msg.sender);
_grantRole(Roles.EXECUTOR, msg.sender);
// DELETE all other grant calls

// 4. Position creation (line 378):
// DELETE: position.execNonce = 1;
// DELETE: position.emergencyUnlockAt = 0;

// 5. Modify function (line 451):
_persistMetadata(positionId);
emit PositionModified(positionId, params);
// DELETE: _bumpExecNonce(positionId, position);

// 6. Pause function (line 470):
emit PositionPaused(positionId);
// DELETE: _bumpExecNonce(positionId, position);

// 7. Resume function (line 490):
emit PositionResumed(positionId);
// DELETE: _bumpExecNonce(positionId, position);

// 8. Cancel function (line 509):
emit PositionCanceled(positionId);
// DELETE: _bumpExecNonce(positionId, position);

// 9. Delete emergencyWithdraw() entirely (lines 519-564)

// 10. onFill function (line 644):
// Change signature to remove expectedNonce:
function onFill(
    uint256 positionId,
    uint256 quoteUsed,
    uint256 baseUsed,
    uint256 quoteReceived,
    uint256 baseReceived,
    uint64 nextExecAt
    // DELETE: uint64 expectedNonce
) external onlyRole(Roles.EXECUTOR) nonReentrant {
    Position storage position = _positions[positionId];
    if (!position.exists) revert PositionNotFound();
    // DELETE: if (position.execNonce != expectedNonce) revert ExecNonceMismatch(...);
    if (position.canceled) revert PositionAlreadyCanceled();
    // ... rest unchanged
    emit PositionExecuted(positionId, quoteUsed, baseUsed, quoteReceived, baseReceived, nextExecAt);
    // DELETE: _bumpExecNonce(positionId, position);
}

// 11. Delete functions:
// - positionExecNonce() (line 712-715)
// - getAllowedBaseTokens() (line 748-750)
// - setCircuitBreakerConfig() (line 766-772)
// - setKeeperRegistry() (line 774-781)
// - setEmergencyDelay() (line 811-813)
// - reconcileActivePositions() (line 848-854)
// - _bumpExecNonce() (line 895-898) 

// 12. Update onPositionTransfer hook:
// Remove _removeOwnerPosition calls since we're not tracking array
function onPositionTransfer(uint256 positionId, address from, address to) external onlyPositionNFT {
    Position storage position = _positions[positionId];
    if (!position.exists) return;
    
    // SIMPLIFY: just update owner, don't manipulate arrays
    if (from != address(0) && userPositionCount[from] > 0) {
        userPositionCount[from] -= 1;
    }
    if (to != address(0)) {
        if (userPositionCount[to] >= maxPositionsPerUser) {
            revert MaxPositionsPerUserExceeded();
        }
        userPositionCount[to] += 1;
        position.owner = to;
        _persistMetadata(positionId);
    }
}

// 13. Delete functions that use position arrays:
// - _removeOwnerPosition() (line 931-953)
```

**Verification:**
- [ ] Compile: `npx hardhat compile`
- [ ] Run DcaManager tests: `npm run test -- dcaManager.spec.ts`
- [ ] No references to emergencyWithdraw in code

---

### Action 4: Update Executor.sol
**Time: 45 minutes**

**Changes:**
```
Lines to DELETE:
- 96-97: _trackedPositions[] and _isTracked mapping
- 88-89: PUBLIC_EXECUTION_GRACE constant
- 148-154: trackPosition() function
- 255-267: checkUpkeep() function
- 269-274: performUpkeep() function
- 276-287: executePublic() function

Lines to MODIFY:
- 241-243: execute() - keep but remove nonce parameter
- 246-253: batchExecute() - keep as-is
- 307-322: selectRoute() - simplify to Uni-only
- 379: _execute() - remove nonce from onFill call
- 384: _execute() - remove expectedNonce calculation
```

**Code changes:**

```solidity
// 1. Remove class members (line 96-97):
// DELETE:
// uint256[] private _trackedPositions;
// mapping(uint256 => bool) private _isTracked;

// 2. Remove constant (line 89):
// DELETE: uint256 public constant PUBLIC_EXECUTION_GRACE = 6 hours;

// 3. Delete functions (lines 148-154, 255-287):
// DELETE: trackPosition()
// DELETE: checkUpkeep()
// DELETE: performUpkeep()
// DELETE: executePublic()

// 4. Simplify execute() (line 241):
function execute(uint256 positionId) external onlyRole(Roles.EXECUTOR) whenNotPaused returns (bool) {
    (bool success,) = _execute(positionId, msg.sender, false);
    return success;
}

// 5. Simplify batchExecute() (line 246):
// Keep as-is - no nonce needed

// 6. Simplify selectRoute() (line 307):
function selectRoute(uint256 positionId) public view returns (uint16 venue, bytes memory routeData) {
    IDcaManager.Position memory position = dcaManager.getPosition(positionId);
    venue = position.venue != 0 ? position.venue : 1; // Default to Uni v3
    address adapter = routerManager.getAdapter(venue);
    routeData = abi.encode(position.quoteToken, position.baseToken, venue, adapter);
}

// 7. Update _execute() signature and body (line 328):
function _execute(uint256 positionId, address keeper, bool isPublic) internal nonReentrant returns (bool, string memory) {
    (bool eligible, string memory reason) = dcaManager.isPositionEligible(positionId);
    if (!eligible) {
        if (!isPublic) {
            revert("Position not eligible");
        }
        emit ExecutionSkipped(positionId, reason);
        return (false, reason);
    }
    
    // ... rest of function unchanged until onFill call ...
    
    // Line 384: DELETE:
    // uint64 expectedNonce = dcaManager.positionExecNonce(positionId);
    
    // Line 416-424: UPDATE onFill call:
    dcaManager.onFill(
        positionId,
        amounts.quoteUsed,
        amounts.baseUsed,
        amounts.quoteReceived,
        amounts.baseReceived,
        nextExecAt
        // DELETE: expectedNonce  <- no longer passed
    );
    
    return (true, "");
}
```

**Verification:**
- [ ] Compile: `npx hardhat compile`
- [ ] Run Executor tests: `npm run test -- executor.spec.ts`
- [ ] No Chainlink/Gelato references remain

---

### Action 5: Update Treasury.sol
**Time: 45 minutes**

**Changes:**
```
Lines to MODIFY:
- 18: Remove TimelockController inheritance
- 56-70: Simplify constructor
- 91-103: Remove setProtocolFeeBps/setReferralFeeBps
- 116-127: Remove setCustomReferralFee/setReferralFeeOnTop
- 137-155: Replace calculateFees() with simple version
- 166-191: Keep collectFees/distributeFees as-is
- 207-225: Keep keeper payment methods
- 231-244: Keep emergency withdraw
- 288-316: DELETE execute/executeBatch (timelock governance)
```

**Code changes:**

```solidity
// 1. Inheritance (line 18):
// BEFORE:
contract Treasury is TimelockController, Pausable, ReentrancyGuard {

// AFTER:
contract Treasury is Pausable, ReentrancyGuard {

// 2. Constructor (line 56):
// BEFORE (50 lines with timelock):
constructor(
    uint256 minDelay,
    address[] memory proposers,
    address[] memory executors,
    address admin
) TimelockController(minDelay, proposers, executors, admin) { ... }

// AFTER (10 lines):
constructor(address admin) {
    require(admin != address(0), "Invalid admin");
    _grantRole(DEFAULT_ADMIN_ROLE, admin);
    _grantRole(TREASURER_ROLE, admin);
    _grantRole(EMERGENCY_ROLE, admin);
    _grantRole(PAUSER_ROLE, admin);
}

// 3. DELETE these functions:
// setProtocolFeeBps() (line 91-96)
// setReferralFeeBps() (line 98-103)
// setCustomReferralFee() (line 116-120)
// setReferralFeeOnTop() (line 122-127)
// execute() (line 288-300)
// executeBatch() (line 303-316)

// 4. REPLACE calculateFees (line 137-155):
// BEFORE (complex with referrals):
function calculateFees(address referrer, uint256 notionalUsd)
    public view returns (uint256 protocolFee, uint256 referralFee) { ... }

// AFTER (simple flat fee):
function calculateFees(uint256 notionalUsd) 
    public pure returns (uint256 protocolFee) 
{
    return (notionalUsd * 20) / 10_000;  // 20 bps flat fee
}

// 5. Remove from FeeConfig struct (line 26-33):
// DELETE: uint16 referralFeeBpsDefault;
// DELETE: bool referralFeeOnTop;

// 6. Update initialize() (line 76-85):
function initialize(FeeConfig calldata config) external {
    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Missing role");
    require(!_initialised, "Already initialized");
    
    // SIMPLIFY - just validate fee collector
    require(config.feeCollector != address(0), "Invalid collector");
    _feeConfig = config;
    _initialised = true;
}

// 7. Keep these functions unchanged:
// collectFees() (line 166-171)
// distributeFees() (line 173-191)
// withdraw() (line 193-201)
// registerKeeperPayment() (line 207-212)
// claimKeeperPayment() (line 214-221)
// emergencyWithdraw() (line 231-235)
// pauseContract() (line 237-243)
```

**Verification:**
- [ ] Compile: `npx hardhat compile`
- [ ] Run Treasury tests: `npm run test -- treasury.spec.ts`
- [ ] No TimelockController methods remain

---

### Action 6: Update RouterManager.sol
**Time: 20 minutes**

**Changes:**
```solidity
// DELETE:
// Line 19: uint16[] private _registeredVenues;

// In addRouterAdapter() DELETE:
// _registeredVenues.push(venue);

// DELETE entire function:
// registeredVenues() (line 88-90)
// _removeVenue() (line 92-103)
```

**Result: 30 lines instead of 105**

---

### Action 7: Update PositionNFT.sol
**Time: 20 minutes**

**Changes:**
```solidity
// Line 66: Change from
function mint(address to, uint256 tokenId) external onlyRole(Roles.MINTER) {
// To:
function mint(address to, uint256 tokenId) external onlyRole(Roles.DEFAULT_ADMIN) {

// Line 76: Change from
function burn(uint256 tokenId) external onlyRole(Roles.BURNER) {
// To:
function burn(uint256 tokenId) external onlyRole(Roles.DEFAULT_ADMIN) {
```

---

### Action 8: Update PriceOracle.sol
**Status:** ✅ No changes needed

---

## Phase 2: Testing Updates
**Time: 1 hour**

### Tests to Update:
```
1. dcaManager.spec.ts:
   - Remove emergency withdrawal tests
   - Remove nonce-related tests
   - Remove circuit breaker tests
   - Remove ownership tracking array tests

2. executor.spec.ts:
   - Remove checkUpkeep/performUpkeep tests
   - Remove executePublic tests
   - Remove CoW routing tests
   - Simplify selectRoute tests (Uni-only)
   - Remove nonce validation tests

3. treasury.spec.ts:
   - Remove TimelockController tests
   - Remove referral fee tests
   - Simplify to flat 20 bps fee
   - Remove governance tests

4. routers.spec.ts:
   - Remove CoWAdapter tests
   - Remove OneInchAdapter tests
   - Keep UniV3Adapter tests only
```

---

## Phase 3: Integration Testing
**Time: 30 minutes**

Create new test: `tests/integration/mvp-flow.spec.ts`

```typescript
describe("MVP Flow", () => {
  it("Should execute complete user journey", async () => {
    // 1. Create position
    // 2. Deposit funds
    // 3. Execute trade by keeper
    // 4. Check balances updated
    // 5. Withdraw proceeds
  });

  it("Should handle multiple positions", async () => {
    // Create 5 positions
    // Execute all in batch
    // Verify state consistency
  });

  it("Should pause/resume correctly", async () => {
    // Pause position
    // Attempt execute (should fail)
    // Resume position
    // Execute (should succeed)
  });
});
```

---

## Checklist: Complete MVP Refactoring

### Code Changes
- [ ] Delete CoWAdapter.sol, OneInchAdapter.sol, PositionStorage.sol
- [ ] Delete test mocks for CoW/1inch
- [ ] Simplify Roles.sol to 4 roles
- [ ] Update DcaManager.sol (remove 15+ functions/fields)
- [ ] Update Executor.sol (remove Chainlink/public execution)
- [ ] Update Treasury.sol (remove timelock/referrals)
- [ ] Update RouterManager.sol (remove venue array)
- [ ] Update PositionNFT.sol (simplify role grants)
- [ ] PriceOracle.sol (no changes)

### Testing
- [ ] Delete tests for removed features
- [ ] Update existing tests for simplified signatures
- [ ] Add MVP integration test
- [ ] Run full test suite: `npm run test`
- [ ] Check coverage: `npm run coverage`

### Documentation
- [ ] Update CLAUDE.md to reflect MVP scope
- [ ] Remove mentions of CoW, 1inch, referrals, circuit breakers
- [ ] Document keeper execution model (off-chain)
- [ ] Update README with MVP limitations

### Verification
- [ ] `npm run build` succeeds
- [ ] `npm run test` passes all tests
- [ ] `npm run lint` finds no issues
- [ ] `npm run coverage` shows >90% for core contracts

---

## Estimated Effort

| Task | Time | Status |
|------|------|--------|
| Delete files | 0.5h | Easy |
| Update Roles.sol | 0.25h | Easy |
| Update DcaManager.sol | 1.5h | Medium |
| Update Executor.sol | 0.75h | Medium |
| Update Treasury.sol | 0.75h | Medium |
| Update RouterManager.sol | 0.25h | Easy |
| Update PositionNFT.sol | 0.25h | Easy |
| Update tests | 1.5h | Medium |
| Integration test | 0.5h | Medium |
| Docs update | 0.5h | Easy |
| **TOTAL** | **~6.5 hours** | - |

**Recommendation:** Allocate 8 hours (includes debugging/verification)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Compiler errors after deletions | HIGH | Compile frequently, run tests after each major change |
| Broken imports | HIGH | Use IDE find-references to catch all usages |
| Test failures | MEDIUM | Update test signatures for removed nonce parameters |
| Gas calculation changes | LOW | Compare gas before/after on sample transactions |
| Security vulnerabilities | HIGH | Ensure nonce removal doesn't enable double-execution (won't, position pause prevents it) |

---

## Post-MVP Deployment (M1-M3)

Once MVP is live and stable:

1. **M1 (Weeks 3-6):**
   - Add CoWAdapter back (reuse existing code)
   - Implement Chainlink Automation
   - Add circuit breaker logic
   - Deploy in new Executor v2

2. **M2 (Weeks 7-10):**
   - Integrate 1inch fallback
   - Complete audit
   - Add multi-oracle validation

3. **M3 (Post-GA):**
   - Add referral system
   - Implement Treasury governance
   - L2 support

All existing positions remain compatible through UUPS upgrades.

