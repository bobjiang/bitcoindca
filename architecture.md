# Bitcoin DCA Architecture

This document provides a comprehensive architecture overview of the Bitcoin DCA application, showing the interaction between smart contracts, keeper infrastructure, routing mechanisms, and user interfaces.

## System Architecture Overview

```mermaid
graph TB
    %% User Layer
    subgraph "User Interface"
        UI[Next.js Frontend]
        Wallet[Wallet Integration<br/>RainbowKit/wagmi]
        Safe[Safe App Mode<br/>Multisig Support]
    end

    %% Smart Contract Layer
    subgraph "Smart Contract Layer"
        subgraph "Core Contracts"
            DCA[DcaManager<br/>UUPS Upgradeable<br/>- Position Management<br/>- Balance Tracking<br/>- Authorization]
            NFT[PositionNFT<br/>ERC-721<br/>- Position Metadata<br/>- Ownership Tracking]
            Storage[PositionStorage<br/>Upgradeable Storage<br/>- Position Data<br/>- Balance Mappings]
        end
        
        subgraph "Execution Layer"
            Exec[Executor<br/>- Keeper Entrypoint<br/>- Guard Enforcement<br/>- Route Selection<br/>- Accounting Updates]
            Router[Router Adapters]
            UniV3[UniV3Adapter<br/>- Flashbots Support<br/>- Private Transactions]
            COW[CoWAdapter<br/>- Partial Fills<br/>- MEV Protection]
            OneInch[OneInchAdapter<br/>- Fallback Routing]
        end
        
        subgraph "Oracle & Pricing"
            Oracle[PriceOracle<br/>- Chainlink Feeds<br/>- TWAP Utilities<br/>- Price Validation]
            ChainlinkBTC[Chainlink BTC/USD]
            ChainlinkETH[Chainlink ETH/USD]
            ChainlinkUSDC[Chainlink USDC/USD]
            ChainlinkWBTC[Chainlink WBTC/BTC]
        end
        
        subgraph "Fee Management"
            Treasury[Treasury<br/>2/3 Multisig<br/>Timelock<br/>- Fee Collection<br/>- Emergency Controls]
        end
    end

    %% Keeper Infrastructure
    subgraph "Keeper Infrastructure"
        subgraph "Primary Keepers"
            Chainlink[Chainlink Automation<br/>- checkUpkeep()<br/>- batchExecute()<br/>- Time-based Triggers]
        end
        
        subgraph "Backup Keepers"
            Gelato[Gelato Network<br/>- Mirrored Tasks<br/>- Fallback Execution]
            Public[Public Execution<br/>- 6h Grace Period<br/>- Tip-based Incentives<br/>- Griefing Protection]
        end
    end

    %% Routing & DEX Layer
    subgraph "DEX & Routing Layer"
        subgraph "Auto Routing Logic"
            Routing[Routing Engine<br/>- Notional Analysis<br/>- Slippage Estimation<br/>- Venue Selection]
        end
        
        subgraph "DEX Protocols"
            UniswapV3[Uniswap V3<br/>- Multiple Fee Tiers<br/>- TWAP Calculations<br/>- Liquidity Depth]
            CoWProtocol[CoW Protocol<br/>- Batch Auctions<br/>- MEV Protection<br/>- Partial Fills]
            OneInchDEX[1inch Aggregator<br/>- Multi-DEX<br/>- Optimal Routes<br/>- Fallback Option]
        end
        
        subgraph "MEV Protection"
            Flashbots[Flashbots<br/>Private Transactions<br/>MEV Protection]
        end
    end

    %% Data & Analytics
    subgraph "Data Layer"
        subgraph "On-chain Data"
            Events[Contract Events<br/>- PositionCreated<br/>- Executed<br/>- ExecutionSkipped<br/>- ExecutionDetails]
        end
        
        subgraph "Off-chain Data"
            Subgraph[The Graph<br/>Subgraph<br/>- Position History<br/>- Execution Logs<br/>- Analytics Data]
            Indexing[Graph Protocol<br/>Indexing<br/>- Real-time Updates<br/>- Historical Data]
        end
        
        subgraph "Analytics"
            Metrics[Analytics Dashboard<br/>- Success Rates<br/>- Fee Tracking<br/>- Performance Metrics]
            CSV[CSV Export<br/>- Transaction History<br/>- Cost Basis<br/>- Route Analysis]
        end
    end

    %% External Services
    subgraph "External Services"
        subgraph "Infrastructure"
            RPC[Ethereum RPC<br/>- Alchemy/Infura<br/>- Transaction Broadcasting]
            IPFS[IPFS<br/>- NFT Metadata<br/>- Position Details]
        end
        
        subgraph "Monitoring"
            Sentry[Sentry<br/>Error Tracking<br/>Frontend Monitoring]
            PostHog[PostHog<br/>Product Analytics<br/>User Behavior]
        end
        
        subgraph "Notifications"
            EPNS[Push Protocol<br/>Execution Alerts<br/>User Notifications]
            Webhook[Webhook Service<br/>Custom Notifications<br/>Integration Hooks]
        end
    end

    %% Circuit Breakers & Security
    subgraph "Security & Circuit Breakers"
        subgraph "Market Protections"
            Breakers[Circuit Breakers<br/>- Daily Volume Limits<br/>- Price Movement Caps<br/>- Oracle Staleness]
            Guards[Position Guards<br/>- Slippage Limits<br/>- Price Caps/Floors<br/>- Stable Depeg Checks]
        end
        
        subgraph "Emergency Controls"
            Pause[Emergency Pause<br/>- Global Pause<br/>- Asset-specific Pause<br/>- Venue-specific Pause]
            Withdraw[Emergency Withdraw<br/>- 7-day Delay<br/>- Full Position Recovery<br/>- No In-flight Swaps]
        end
    end

    %% Connection Flows
    UI --> Wallet
    Wallet --> DCA
    Safe --> DCA
    
    DCA --> NFT
    DCA --> Storage
    DCA --> Exec
    DCA --> Treasury
    
    Exec --> Router
    Router --> UniV3
    Router --> COW
    Router --> OneInch
    
    Exec --> Oracle
    Oracle --> ChainlinkBTC
    Oracle --> ChainlinkETH
    Oracle --> ChainlinkUSDC
    Oracle --> ChainlinkWBTC
    
    Chainlink --> Exec
    Gelato --> Exec
    Public --> Exec
    
    Exec --> Routing
    Routing --> UniswapV3
    Routing --> CoWProtocol
    Routing --> OneInchDEX
    
    UniV3 --> Flashbots
    
    DCA --> Events
    Exec --> Events
    Events --> Subgraph
    Subgraph --> Indexing
    Indexing --> Metrics
    Subgraph --> CSV
    
    UI --> Subgraph
    UI --> RPC
    
    NFT --> IPFS
    
    UI --> Sentry
    UI --> PostHog
    Exec --> EPNS
    Exec --> Webhook
    
    DCA --> Breakers
    Exec --> Guards
    Breakers --> Pause
    Guards --> Withdraw
    
    %% Fee Flows
    Exec --> Treasury
    Treasury --> Chainlink
    Treasury --> Gelato

    %% Styling
    classDef userLayer fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef contractLayer fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef keeperLayer fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef dexLayer fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef dataLayer fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef externalLayer fill:#f1f8e9,stroke:#33691e,stroke-width:2px
    classDef securityLayer fill:#ffebee,stroke:#b71c1c,stroke-width:2px

    class UI,Wallet,Safe userLayer
    class DCA,NFT,Storage,Exec,Router,UniV3,COW,OneInch,Oracle,ChainlinkBTC,ChainlinkETH,ChainlinkUSDC,ChainlinkWBTC,Treasury contractLayer
    class Chainlink,Gelato,Public keeperLayer
    class Routing,UniswapV3,CoWProtocol,OneInchDEX,Flashbots dexLayer
    class Events,Subgraph,Indexing,Metrics,CSV dataLayer
    class RPC,IPFS,Sentry,PostHog,EPNS,Webhook externalLayer
    class Breakers,Guards,Pause,Withdraw securityLayer
```

## Architecture Components

### 1. Smart Contract Layer

#### Core Contracts
- **DcaManager**: Central coordinator implementing UUPS upgradeability pattern
- **PositionNFT**: ERC-721 tokens representing user positions with metadata
- **PositionStorage**: Separate upgradeable storage contract to avoid NFT logic conflicts
- **Executor**: Keeper entrypoint with guard enforcement and route selection
- **Router Adapters**: Protocol-specific adapters for different DEX integrations
- **PriceOracle**: Multi-source price feeds with Chainlink integration and TWAP utilities
- **Treasury**: Fee collection with multisig governance and timelock controls

#### Key Features
- **Upgradeability**: UUPS pattern for core contracts with separate storage
- **Non-custodial**: Users maintain control of their funds
- **Modular Design**: Pluggable router adapters for different DEX protocols
- **Security**: Circuit breakers, guards, and emergency controls

### 2. Keeper Infrastructure

#### Primary Keeper
- **Chainlink Automation**: Time-based execution with batch processing capabilities
- **checkUpkeep()**: Evaluates position eligibility and execution conditions
- **batchExecute()**: Efficient batch processing with gas optimization

#### Backup Keepers
- **Gelato Network**: Mirrored tasks for redundancy
- **Public Execution**: 6-hour grace period with tip-based incentives
- **Griefing Protection**: Cooldown mechanisms and position-specific limits

### 3. Routing & DEX Integration

#### Auto Routing Logic
- **Intelligent Routing**: Notional-based venue selection ($5k threshold)
- **MEV Protection**: Flashbots integration for private transactions
- **Fallback Mechanisms**: Multi-tier routing with CoW → UniV3 → 1inch cascade
- **Partial Fills**: CoW Protocol support for large orders

#### Supported Protocols
- **Uniswap V3**: Multiple fee tiers with TWAP calculations
- **CoW Protocol**: Batch auctions with MEV protection
- **1inch Aggregator**: Multi-DEX routing with optimal pathfinding

### 4. Security & Circuit Breakers

#### Market Protections
- **Daily Volume Limits**: $10M global cap with automatic pausing
- **Price Movement Caps**: 20% maximum price movement in 1-hour windows
- **Oracle Staleness**: 30-minute maximum staleness for price feeds
- **Stable Depeg Checks**: 1% maximum deviation from USD peg

#### Position Guards
- **Slippage Limits**: Configurable slippage protection (default 0.5%)
- **Price Caps/Floors**: BUY/SELL price protection mechanisms
- **Gas Caps**: Maximum gas price protection per position
- **TWAP Deviation**: Maximum deviation from time-weighted average price

### 5. Data & Analytics

#### On-chain Data
- **Contract Events**: Comprehensive event logging for all operations
- **Execution Details**: Extended telemetry with route information and price impact
- **Position History**: Complete audit trail of all position activities

#### Off-chain Infrastructure
- **The Graph Subgraph**: Real-time indexing of contract events
- **Analytics Dashboard**: Performance metrics and success rate tracking
- **CSV Export**: Complete transaction history with cost basis analysis

### 6. User Interface

#### Frontend Architecture
- **Next.js 15+**: React Server Components with file-based routing
- **wagmi v2 + viem**: Type-safe Web3 interactions
- **RainbowKit**: Wallet integration with WalletConnect v2 support
- **Safe App Mode**: Multisig integration for treasury management

#### Key Features
- **Strategy Wizard**: 4-step position creation process
- **Positions Dashboard**: Real-time status and performance tracking
- **Execution Logs**: Detailed transaction history with route analysis
- **Health Monitoring**: Circuit breaker status and system health indicators

## Execution Flow

### 1. Position Creation
1. User connects wallet and navigates to strategy wizard
2. Frontend validates parameters and estimates costs
3. User approves Permit2 allowances and signs position creation transaction
4. DcaManager mints PositionNFT and initializes position storage
5. Position becomes eligible for execution based on start time

### 2. Execution Cycle
1. Chainlink Automation checks position eligibility via checkUpkeep()
2. Executor validates all guards (oracle staleness, TWAP deviation, price caps)
3. Router selects optimal venue based on notional size and slippage estimates
4. Trade execution with MEV protection (Flashbots for UniV3, CoW for large orders)
5. Accounting updates with fee collection and next execution scheduling
6. Events emitted for subgraph indexing and user notifications

### 3. Position Management
1. Users can deposit/withdraw funds anytime (except during execution)
2. Position modifications limited to safe fields (slippage, venue, gas caps)
3. Emergency pause available with 7-day delayed emergency withdrawal
4. CSV export provides complete transaction history for tax reporting

## Security Considerations

### Smart Contract Security
- **Formal Verification**: Invariant checking for value conservation and fee caps
- **Audits**: Pre-mainnet audits with ongoing bug bounty program
- **Access Controls**: Role-based permissions with multisig governance
- **Reentrancy Protection**: nonReentrant modifiers on all external functions

### Operational Security
- **Circuit Breakers**: Automatic pausing on extreme market conditions
- **Oracle Security**: Multi-source price feeds with staleness checks
- **MEV Protection**: Private transaction routing and CoW Protocol integration
- **Emergency Controls**: Time-delayed emergency withdrawal mechanisms

## Deployment Phases

### M0 (Weeks 1-2): MVP
- UniV3 BUY-only with USDC↔WBTC
- Daily cadence with manual keeper
- Basic subgraph and system limits

### M1 (Weeks 3-6): Core Features
- SELL functionality and all cadences
- Chainlink + Gelato automation
- PositionNFT with storage separation
- Batch execution and public fallback

### M2 (Weeks 7-10): Advanced Features
- CoW Protocol routing with partial fills
- AUTO router with intelligent venue selection
- Extended telemetry and circuit breakers
- Mainnet beta with conservative limits

### M3 (Post-GA): Scale
- Gradual limit increases
- L2 readiness and tBTC support
- Advanced analytics and dashboards
- Community governance integration

This architecture provides a robust, secure, and scalable foundation for non-custodial Bitcoin DCA operations on Ethereum, with comprehensive MEV protection, circuit breakers, and user-friendly interfaces.
