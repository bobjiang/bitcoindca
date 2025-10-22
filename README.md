# DCA Crypto

Non-custodial automated Dollar Cost Averaging (DCA) for crypto assets on Ethereum.

## Project Structure

```
.
├── contracts/          # Solidity smart contracts (Hardhat)
│   └── test/           # Hardhat test suites
├── frontend/           # Next.js web application
├── docs/               # Docusaurus documentation source
├── CLAUDE.md          # Project requirements and architecture
├── architecture.md    # System architecture details
├── user-flow.md       # User flow documentation
└── tech-stacks.md     # Technology stack details
```

## Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0

## Getting Started

### 1. Install Dependencies

```bash
# Install root dependencies
pnpm install

# Install contracts dependencies
cd contracts && pnpm install

# Install frontend dependencies
cd ../frontend && pnpm install
```

### 2. Configure Environment

```bash
# Copy environment templates
cp contracts/.env.example contracts/.env
cp frontend/.env.example frontend/.env

# Edit .env files with your configuration
```

### 3. Development

#### Smart Contracts

```bash
# Compile contracts
pnpm contracts:compile

# Run core Hardhat tests (unit + ABI/spec suites)
pnpm --filter ./contracts test
# or (via workspace script)
pnpm contracts:test

# Run behaviour + integration suites (requires env toggle)
RUN_DCA_BEHAVIOR_TESTS=true pnpm --filter ./contracts test test/system.behavior.spec.ts
RUN_DCA_BEHAVIOR_TESTS=true pnpm --filter ./contracts test test/integration/**/*.test.ts

# Generate gas report
pnpm --filter ./contracts test:gas

# Generate coverage report
pnpm --filter ./contracts test:coverage

# Deploy to local network
pnpm contracts:deploy:local

# Deploy to Sepolia testnet
pnpm contracts:deploy:sepolia
```

`RUN_DCA_BEHAVIOR_TESTS=true` enables longer-running scenarios that deploy full UUPS stacks and execute end-to-end flows. Leave it unset for the quick ABI and unit regression suite.

#### Frontend

```bash
# Start development server
pnpm frontend:dev

# Build for production
pnpm frontend:build

# Start production server
pnpm frontend:start

# Run unit tests (Vitest)
pnpm frontend:test

# Watch tests during development
pnpm frontend:test:watch

# Standalone type-check
pnpm frontend:type-check
```

## Tech Stack

### Frontend
- Next.js 15+ with React 18 and TypeScript
- Tailwind CSS + shadcn/ui
- wagmi v2 + viem + RainbowKit
- TanStack Query & Table
- react-hook-form + zod

### Smart Contracts
- Solidity ^0.8.20
- Hardhat with TypeScript
- OpenZeppelin Contracts
- Chainlink Automation & Oracles

### Testing
- Hardhat (contracts)
- Vitest + React Testing Library (frontend)
- Playwright (e2e)
- Solidity test suites live in `contracts/test`

## Documentation

- [Architecture](./architecture.md)
- [User Flow](./user-flow.md)
- [Tech Stacks](./tech-stacks.md)
- [Project Requirements](./CLAUDE.md)
- [Docs Source](./docs/)
- Docusaurus site (`/docs` route in the frontend):
  - Local authoring: `pnpm docs:dev`
  - Build & sync into Next.js: `pnpm docs:sync` (copies `docs/build` into `frontend/public/docs`)

## License

MIT
