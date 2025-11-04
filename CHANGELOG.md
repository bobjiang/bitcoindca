# Changelog

## Unreleased
- Extend DcaManager with `createPositionWithBase` and admin-managed base asset registry (enables ETH DCA positions).
- Add Flashbots Protect execution toggle across Hardhat tooling and the dashboard API (issue #8).
- Fix deployment script hanging issue: make Hardhat forking opt-in via `ENABLE_FORKING=true` env var instead of automatically enabling when `MAINNET_RPC_URL` is set. Add timeout configurations to prevent indefinite hangs.
