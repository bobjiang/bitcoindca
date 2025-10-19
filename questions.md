create position:
## 7. Fund the position
- Click **Deposit** and choose the asset matching your strategy direction.
separate process? or bind in create position.

manage balance:
Immutable fields (quote/base assets, amount per period, start/end times) require cancelling and creating a new position. Attempting to modify them reverts with `ImmutableField()` as enforced in `contracts/test/dcaManager.abi.spec.ts`.


architecture:
Data contracts
Position storage — Lives in a dedicated storage contract to preserve layout across upgrades.
Telemetry — Events capture status, gas usage, and route decisions. ExecutionDetails includes route path bytes and price impact bps for analytics pipelines.
System configuration — Structs such as ProtocolConfig, CircuitBreakerConfig, and VenueConfig allow fine-grained adjustments without redeploying contracts.

DEX:
buy ETH or WETH?
should be simpler and safer to buy WETH (not ETH).