# Bitcoin DCA

Non-custodial automated Dollar Cost Averaging (DCA) for WBTC on Ethereum.

## Project Structure

```
.
├── contracts/          # Solidity smart contracts (Hardhat)
├── frontend/           # Next.js web application
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

# Run tests
pnpm contracts:test

# Deploy to local network
pnpm contracts:deploy:local

# Deploy to Sepolia testnet
pnpm contracts:deploy:sepolia
```

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

## Documentation

- [Architecture](./architecture.md)
- [User Flow](./user-flow.md)
- [Tech Stacks](./tech-stacks.md)
- [Project Requirements](./CLAUDE.md)

## License

MIT
