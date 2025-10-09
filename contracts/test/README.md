# Bitcoin DCA Smart Contract Test Suite

Comprehensive test suite for the Bitcoin DCA smart contract system using Hardhat, Mocha, and Chai.

## Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Writing Tests](#writing-tests)
- [Fixtures and Helpers](#fixtures-and-helpers)
- [Continuous Integration](#continuous-integration)

## Overview

This test suite provides comprehensive coverage of all smart contracts in the Bitcoin DCA system:

- **Unit Tests**: Test individual contract functionality in isolation
- **Integration Tests**: Test interactions between multiple contracts
- **End-to-End Tests**: Test complete user workflows from start to finish
- **ABI Conformance Tests**: Guard the public interface (functions/events) required by the product and analytics layers

### Test Framework

- **Hardhat**: Ethereum development environment
- **Mocha**: Test framework
- **Chai**: Assertion library
- **@nomicfoundation/hardhat-network-helpers**: Testing utilities

## Test Structure

```
test/
├── fixtures/
│   └── deployments.ts          # Deployment fixtures for different scenarios
├── helpers/
│   ├── constants.ts            # Test constants and enums
│   ├── mocks.ts                # Mock contract deployment helpers
│   └── utils.ts                # Utility functions for testing
├── unit/
│   ├── core/
│   │   ├── DcaManager.test.ts  # DcaManager contract tests
│   │   └── PositionNFT.test.ts # PositionNFT contract tests
│   ├── execution/
│   │   └── Executor.test.ts    # Executor contract tests
│   ├── oracles/
│   │   └── PriceOracle.test.ts # PriceOracle contract tests
│   └── routers/
│       ├── UniV3Adapter.test.ts
│       ├── CoWAdapter.test.ts
│       └── OneInchAdapter.test.ts
└── integration/
    └── EndToEnd.test.ts        # End-to-end integration tests
```

## Running Tests

> **Note**
> Behavioural tests rely on fully implemented contracts. Until the core system ships, they are skipped by default. Set
> `RUN_DCA_BEHAVIOR_TESTS=true` to execute deployment, lifecycle, and integration specs once contracts are ready. ABI
> conformance suites always run to guard interface regressions.

### Run All Tests

```bash
cd contracts
pnpm test
```

### Run Specific Test Files

```bash
# Run DcaManager tests only (behavioural suite)
RUN_DCA_BEHAVIOR_TESTS=true pnpm hardhat test test/unit/core/DcaManager.test.ts

# Run Executor tests only
pnpm hardhat test test/unit/execution/Executor.test.ts

# Run integration tests only
RUN_DCA_BEHAVIOR_TESTS=true pnpm hardhat test test/integration/EndToEnd.test.ts
```

### Run Tests by Pattern

```bash
# Run all unit tests
RUN_DCA_BEHAVIOR_TESTS=true pnpm hardhat test test/unit/**/*.test.ts

# Run all core contract tests
pnpm hardhat test test/unit/core/*.test.ts

# Run all oracle tests
pnpm hardhat test test/unit/oracles/*.test.ts
```

### Run Tests with Gas Reporting

```bash
pnpm test:gas
```

### Run Tests with Coverage

```bash
pnpm test:coverage
```

This generates a coverage report in the `coverage/` directory.

### Run Tests in Parallel (faster)

```bash
pnpm hardhat test --parallel
```

## Test Coverage

The test suite aims for comprehensive coverage of:

### DcaManager Contract
- ✅ Position creation and validation
- ✅ Position management (pause, resume, modify, cancel)
- ✅ Deposit and withdrawal functionality
- ✅ Emergency withdrawals
- ✅ System limits and circuit breakers
- ✅ Access control
- ✅ Upgradeability

### PositionNFT Contract
- ✅ NFT minting and burning
- ✅ Token metadata and URIs
- ✅ Token transfers
- ✅ Access control for minting/burning
- ✅ Integration with PositionStorage
- ✅ ERC-721 compliance

### Executor Contract
- ✅ Execution eligibility checks
- ✅ Guard validation (oracle staleness, TWAP, price deviation, depeg)
- ✅ Position execution logic
- ✅ Batch execution
- ✅ Fee calculations
- ✅ Route selection
- ✅ Chainlink Automation integration
- ✅ Public execution with grace period

### PriceOracle Contract
- ✅ Chainlink price feed integration
- ✅ TWAP calculations
- ✅ Price validation and staleness checks
- ✅ Deviation detection
- ✅ Depeg detection for stablecoins
- ✅ Multi-source price aggregation
- ✅ Oracle management

### Integration Tests
- ✅ Complete BUY position lifecycle
- ✅ Complete SELL position lifecycle
- ✅ Multiple concurrent positions
- ✅ Circuit breaker integration
- ✅ Fee collection and distribution
- ✅ Emergency scenarios
- ✅ NFT transfer and ownership

## Writing Tests

### Test File Template

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployBaseSystemFixture } from "../fixtures/deployments";

describe("MyContract", function () {
  describe("Deployment", function () {
    it("should deploy with correct initial state", async function () {
      const { myContract } = await loadFixture(deployBaseSystemFixture);

      // Your test assertions here
      expect(await myContract.someValue()).to.equal(expectedValue);
    });
  });

  describe("Functionality", function () {
    it("should perform expected behavior", async function () {
      const { myContract, user1 } = await loadFixture(deployBaseSystemFixture);

      // Test the functionality
      await expect(myContract.connect(user1).doSomething())
        .to.emit(myContract, "SomethingDone")
        .withArgs(expectedArgs);
    });
  });
});
```

### Using Fixtures

Fixtures provide a consistent starting state for tests:

```typescript
// Use the base system fixture
const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

// Use the full system with DEX adapters
const { dcaManager, uniV3Adapter, cowAdapter } = await loadFixture(deployFullSystemFixture);

// Use the fixture with a created position
const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);
```

### Using Helper Functions

```typescript
import {
  createDefaultPositionParams,
  advanceTime,
  getCurrentTime,
  calculateProtocolFee,
} from "../helpers/utils";

// Create position parameters with defaults
const params = createDefaultPositionParams(user1.address, {
  amountPerPeriod: ethers.parseUnits("100", 6),
});

// Advance blockchain time
await advanceTime(24 * 3600); // 1 day

// Calculate fees
const fee = calculateProtocolFee(notional, 20); // 20 bps
```

### Best Practices

1. **Use Fixtures**: Always use `loadFixture` for consistent test state
2. **Descriptive Names**: Use clear, descriptive test names
3. **Arrange-Act-Assert**: Structure tests with setup, action, and verification
4. **Test Edge Cases**: Include tests for boundary conditions and error cases
5. **Gas Efficiency**: Test gas usage for critical operations
6. **Event Verification**: Verify that expected events are emitted
7. **State Changes**: Verify that contract state changes as expected

## Fixtures and Helpers

### Available Fixtures

#### `deployBaseSystemFixture()`
Deploys core contracts without DEX adapters. Use for testing core functionality.

**Returns:**
- Core contracts (DcaManager, PositionNFT, Executor, etc.)
- Mock tokens (WBTC, USDC, DAI, USDT, WETH)
- Mock price feeds
- Test signers (deployer, treasury, users, keeper, executor)

#### `deployFullSystemFixture()`
Deploys complete system including DEX adapters and mock DEXs.

**Returns:**
- Everything from `deployBaseSystemFixture`
- Router adapters (UniV3, CoW, 1inch)
- Mock DEX infrastructure

#### `deployWithPositionFixture()`
Deploys system with a pre-created test position.

**Returns:**
- Everything from `deployFullSystemFixture`
- `positionId`: ID of created position
- `createParams`: Parameters used to create position

#### `deployMultiPositionFixture()`
Deploys system with multiple positions for batch testing.

**Returns:**
- Everything from `deployFullSystemFixture`
- `positionIds[]`: Array of created position IDs

### Helper Functions

#### Time Manipulation
```typescript
advanceTime(seconds: number)          // Advance blockchain time
advanceTimeTo(timestamp: number)      // Advance to specific timestamp
getCurrentTime(): Promise<number>     // Get current block timestamp
```

#### Calculations
```typescript
calculateProtocolFee(notional: bigint, feeBps: number): bigint
calculateExecutionFee(fixedFee: bigint, notional: bigint, gasPremiumBps: number): bigint
calculateSlippage(amount: bigint, slippageBps: number): bigint
calculatePriceImpact(expectedPrice: bigint, actualPrice: bigint): bigint
```

#### Validation
```typescript
isPriceDeviationValid(price1: bigint, price2: bigint, maxDeviationBps: number): boolean
isStableDepegged(price: bigint, peg: bigint, thresholdBps: number): boolean
```

#### Position Creation
```typescript
createDefaultPositionParams(owner: string, overrides?: Partial<CreatePositionParams>)
createDefaultModifyParams(overrides?: Partial<ModifyPositionParams>)
createDefaultFeeConfig(feeCollector: string, overrides?: Partial<FeeConfig>)
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Install pnpm
        uses: pnpm/action-setup@v2

      - name: Install dependencies
        run: cd contracts && pnpm install

      - name: Run tests
        run: cd contracts && pnpm test

      - name: Run coverage
        run: cd contracts && pnpm test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./contracts/coverage/lcov.info
```

## Debugging Tests

### Enable Hardhat Console Logs

```typescript
import { console } from "hardhat/console.sol"; // In your contracts

console.log("Debug value:", value);
```

### Run Tests in Debug Mode

```bash
pnpm hardhat test --logs
```

### Use Stack Traces

```bash
# Enable detailed stack traces
pnpm hardhat test --stack-trace
```

### Use Hardhat Network Helpers

```typescript
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-network-helpers";

// Mine blocks
await mine(100);

// Set next block timestamp
await time.setNextBlockTimestamp(timestamp);

// Get latest block
const latest = await time.latest();
```

## Common Patterns

### Testing Reverts

```typescript
// Expect revert with specific message
await expect(
  contract.someFunction()
).to.be.revertedWith("Error message");

// Expect revert with custom error
await expect(
  contract.someFunction()
).to.be.revertedWithCustomError(contract, "CustomError");
```

### Testing Events

```typescript
// Expect event emission
await expect(contract.someFunction())
  .to.emit(contract, "EventName")
  .withArgs(arg1, arg2);

// Multiple events
await expect(contract.someFunction())
  .to.emit(contract, "Event1")
  .to.emit(contract, "Event2");
```

### Testing State Changes

```typescript
// Get state before
const balanceBefore = await token.balanceOf(user.address);

// Perform action
await contract.doSomething();

// Verify state after
const balanceAfter = await token.balanceOf(user.address);
expect(balanceAfter).to.equal(balanceBefore + expectedChange);
```

## Troubleshooting

### Common Issues

1. **Tests timing out**
   - Increase timeout in Hardhat config
   - Check for infinite loops or gas issues

2. **Inconsistent test results**
   - Ensure proper use of fixtures
   - Check for test interdependencies

3. **Gas estimation errors**
   - Verify contract logic
   - Check for reverts in view functions

4. **Fork testing issues**
   - Update fork block number
   - Check RPC URL configuration

## Additional Resources

- [Hardhat Documentation](https://hardhat.org/docs)
- [Mocha Documentation](https://mochajs.org/)
- [Chai Assertion Library](https://www.chaijs.com/)
- [OpenZeppelin Test Helpers](https://docs.openzeppelin.com/test-helpers/)
- [Hardhat Network Helpers](https://hardhat.org/hardhat-network-helpers)

## Contributing

When adding new tests:

1. Follow the existing directory structure
2. Use appropriate fixtures
3. Include both positive and negative test cases
4. Add edge case tests
5. Document complex test scenarios
6. Ensure tests pass before submitting PR

## License

MIT
