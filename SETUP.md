# Bitcoin DCA - Setup Guide

This guide will help you set up the Bitcoin DCA project from scratch.

## Prerequisites

Ensure you have the following installed:

- **Node.js** >= 18.0.0 ([Download](https://nodejs.org/))
- **pnpm** >= 8.0.0 (Install: `npm install -g pnpm`)
- **Git** ([Download](https://git-scm.com/))

## Step 1: Install Dependencies

```bash
# Install workspace dependencies
pnpm install

# Install contracts dependencies
cd contracts
pnpm install

# Install frontend dependencies
cd ../frontend
pnpm install

# Return to root
cd ..
```

## Step 2: Configure Environment Variables

### Contracts

```bash
cd contracts
cp .env.example .env
```

Edit `contracts/.env` and add:

- `MAINNET_RPC_URL` - Get from [Alchemy](https://www.alchemy.com/) or [Infura](https://infura.io/)
- `SEPOLIA_RPC_URL` - Same as above (Sepolia testnet)
- `PRIVATE_KEY` - Your deployment wallet private key (⚠️ **NEVER** commit this!)
- `ETHERSCAN_API_KEY` - Get from [Etherscan](https://etherscan.io/apis)

### Frontend

```bash
cd ../frontend
cp .env.example .env
```

Edit `frontend/.env` and add:

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` - Get from [WalletConnect Cloud](https://cloud.walletconnect.com/)
- `NEXT_PUBLIC_ALCHEMY_API_KEY` - Your Alchemy API key
- `NEXT_PUBLIC_CHAIN_ID` - `11155111` for Sepolia, `1` for Mainnet

## Step 3: Test the Setup

### Smart Contracts

```bash
# From project root
pnpm contracts:compile

# Run example tests
pnpm contracts:test
```

You should see compilation succeed and tests pass (or skip if no mainnet fork).

### Frontend

```bash
# From project root
pnpm frontend:dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. You should see:
- The Bitcoin DCA landing page
- A "Connect Wallet" button (requires WalletConnect Project ID to function)

## Step 4: Configure shadcn/ui (Optional)

To add UI components from shadcn/ui:

```bash
cd frontend
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
npx shadcn-ui@latest add input
# Add more components as needed
```

## Step 5: Start Local Development

### Option A: Frontend Only

```bash
pnpm frontend:dev
```

### Option B: Local Hardhat Node + Frontend

**Terminal 1:**
```bash
cd contracts
pnpm node
```

**Terminal 2:**
```bash
pnpm frontend:dev
```

## Common Issues

### "WalletConnect Project ID not set"

**Solution:** Add your WalletConnect Project ID to `frontend/.env`:
```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
```
Get one free at [https://cloud.walletconnect.com](https://cloud.walletconnect.com)

### "Module not found" errors

**Solution:** Ensure all dependencies are installed:
```bash
pnpm install
cd contracts && pnpm install
cd ../frontend && pnpm install
```

### TypeScript errors in contracts

**Solution:** Compile contracts first to generate typechain types:
```bash
cd contracts
pnpm compile
```

### Next.js webpack errors

**Solution:** These are often resolved by the configuration in `next.config.js`. If issues persist:
1. Delete `.next` folder: `rm -rf frontend/.next`
2. Reinstall dependencies: `cd frontend && rm -rf node_modules && pnpm install`

## Next Steps

1. **Review Requirements**: Read [CLAUDE.md](./CLAUDE.md) for full project specifications
2. **Implement Contracts**: Start with the contracts defined in the architecture
3. **Build Frontend**: Implement the Strategy Wizard and Positions Dashboard
4. **Testing**: Write comprehensive tests for both contracts and frontend
5. **Deploy**: Follow deployment guides for Sepolia testnet first

## Development Workflow

### Working on Smart Contracts

```bash
# Compile
pnpm contracts:compile

# Test
pnpm contracts:test

# Test with gas reporting
cd contracts && REPORT_GAS=true pnpm test

# Deploy to local network
pnpm contracts:deploy:local

# Deploy to Sepolia
pnpm contracts:deploy:sepolia
```

### Working on Frontend

```bash
# Development server
pnpm frontend:dev

# Type checking
cd frontend && pnpm type-check

# Linting
pnpm lint

# Format code
pnpm format
```

## Resources

- [Hardhat Documentation](https://hardhat.org/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [wagmi Documentation](https://wagmi.sh/)
- [RainbowKit Documentation](https://www.rainbowkit.com/docs/introduction)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)
- [shadcn/ui Components](https://ui.shadcn.com/)

## Getting Help

If you encounter issues:

1. Check the [CLAUDE.md](./CLAUDE.md) requirements
2. Review the error messages carefully
3. Ensure all environment variables are set correctly
4. Try cleaning and reinstalling dependencies

Happy building! 🚀
