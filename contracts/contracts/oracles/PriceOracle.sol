// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Roles} from "../libraries/Roles.sol";

interface ITwapSource {
    function getAveragePrice(uint32 window) external view returns (uint256);
}

/**
 * @title PriceOracle
 * @notice Aggregates price data from Chainlink feeds and simplified Uniswap V3 TWAP sources.
 */
contract PriceOracle is AccessControl {
    struct PriceFeedConfig {
        address feed;
        bool exists;
    }

    struct TwapPool {
        address pool;
        bool exists;
    }

    uint256 public constant MAX_BPS = 10_000;
    uint256 public maxStaleness = 1_800; // default 30 minutes

    mapping(address => PriceFeedConfig) private _priceFeeds;
    mapping(bytes32 => TwapPool) private _uniswapPools;
    mapping(bytes32 => address) private _aliasToken;
    mapping(address => uint256) private _referencePrice;

    event PriceFeedAdded(address indexed token, address indexed feed);
    event PriceFeedUpdated(address indexed token, address indexed feed);
    event PriceFeedRemoved(address indexed token);
    event MaxStalenessUpdated(uint256 maxStaleness);
    event UniswapPoolRegistered(address indexed token0, address indexed token1, uint24 fee, address pool);
    event AliasConfigured(bytes32 indexed aliasKey, address indexed token);
    event ReferencePriceUpdated(address indexed token, uint256 price);

    constructor() {
        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
        _grantRole(Roles.ORACLE_ADMIN, msg.sender);
    }

    modifier onlyOracleAdmin() {
        require(hasRole(Roles.ORACLE_ADMIN, msg.sender), "AccessControl: account");
        _;
    }

    function addPriceFeed(address token, address feed) external onlyOracleAdmin {
        require(token != address(0), "Invalid token address");
        require(feed != address(0), "Invalid feed address");
        require(!_priceFeeds[token].exists, "Feed already exists");

        _priceFeeds[token] = PriceFeedConfig({feed: feed, exists: true});
        emit PriceFeedAdded(token, feed);
    }

    function updatePriceFeed(address token, address feed) external onlyOracleAdmin {
        require(feed != address(0), "Invalid feed address");
        PriceFeedConfig storage config = _priceFeeds[token];
        require(config.exists, "Feed missing");
        config.feed = feed;
        emit PriceFeedUpdated(token, feed);
    }

    function removePriceFeed(address token) external onlyOracleAdmin {
        PriceFeedConfig storage config = _priceFeeds[token];
        require(config.exists, "Feed missing");
        delete _priceFeeds[token];
        emit PriceFeedRemoved(token);
    }

    function getPriceFeed(address token) external view returns (address) {
        return _priceFeeds[token].feed;
    }

    function setMaxStaleness(uint256 newMaxStaleness) external onlyOracleAdmin {
        require(newMaxStaleness > 0, "Invalid staleness");
        maxStaleness = newMaxStaleness;
        emit MaxStalenessUpdated(newMaxStaleness);
    }

    function registerUniswapPool(address token0, address token1, uint24 fee, address pool) external onlyOracleAdmin {
        require(pool != address(0), "Invalid pool address");
        bytes32 keyForward = _poolKey(token0, token1, fee);
        bytes32 keyReverse = _poolKey(token1, token0, fee);
        _uniswapPools[keyForward] = TwapPool({pool: pool, exists: true});
        _uniswapPools[keyReverse] = TwapPool({pool: pool, exists: true});

        emit UniswapPoolRegistered(token0, token1, fee, pool);
    }

    function configureAlias(bytes32 aliasKey, address token) public onlyOracleAdmin {
        require(aliasKey != bytes32(0), "Invalid alias");
        // token can be zero to clear alias
        _aliasToken[aliasKey] = token;
        emit AliasConfigured(aliasKey, token);
    }

    function configureAliasString(string calldata symbol, address token) external onlyOracleAdmin {
        configureAlias(keccak256(bytes(symbol)), token);
    }

    function setReferencePrice(address token, uint256 price) external onlyOracleAdmin {
        require(token != address(0), "Invalid token address");
        require(price > 0, "Invalid price");
        _referencePrice[token] = price;
        emit ReferencePriceUpdated(token, price);
    }

    function referencePrice(address token) external view returns (uint256) {
        return _referencePrice[token];
    }

    function getChainlinkPrice(address feed) public view returns (uint256 price, uint256 updatedAt) {
        require(feed != address(0), "Invalid price feed");
        (, int256 answer,, uint256 updatedTimestamp,) = AggregatorV3Interface(feed).latestRoundData();
        require(answer > 0, "Invalid price");
        price = uint256(answer);
        updatedAt = updatedTimestamp;
    }

    function getTokenPrice(address token) public view returns (uint256 price, uint256 updatedAt) {
        PriceFeedConfig memory config = _priceFeeds[token];
        require(config.exists, "Feed missing");
        return getChainlinkPrice(config.feed);
    }

    function validatePriceStaleness(uint256 timestamp) external view returns (bool) {
        if (timestamp > block.timestamp) {
            return true;
        }
        return block.timestamp - timestamp <= maxStaleness;
    }

    function validatePriceDeviation(
        uint256 price1,
        uint256 price2,
        uint256 maxDeviationBps
    ) public pure returns (bool, uint256) {
        if (price1 == 0 || price2 == 0) {
            return (false, MAX_BPS);
        }

        if (price1 == price2) {
            return (true, 0);
        }

        uint256 diff = price1 > price2 ? price1 - price2 : price2 - price1;
        uint256 deviationBps = (diff * MAX_BPS) / price1;
        return (deviationBps <= maxDeviationBps, deviationBps);
    }

    function checkDepeg(address token, uint256 thresholdBps) external view returns (bool, uint256) {
        (uint256 price,) = getTokenPrice(token);
        (bool valid, uint256 deviationBps) = validatePriceDeviation(price, 1e8, thresholdBps); // assume $1 peg
        return (!valid, deviationBps);
    }

    function getUniswapV3TWAP(address pool, uint32 window) public view returns (uint256) {
        require(pool != address(0), "Invalid pool address");
        require(window > 0, "Invalid TWAP window");
        return ITwapSource(pool).getAveragePrice(window);
    }

    function getTWAP(address tokenIn, address tokenOut, uint24 fee, uint32 window) public view returns (uint256) {
        bytes32 key = _poolKey(tokenIn, tokenOut, fee);
        TwapPool memory stored = _uniswapPools[key];
        require(stored.exists, "Pool missing");
        return getUniswapV3TWAP(stored.pool, window);
    }

    function getAggregatedPrice(address token, uint256 minConfidencePercent) external view returns (uint256, uint256) {
        require(minConfidencePercent <= 100, "Invalid confidence threshold");
        (uint256 chainlinkPrice, uint256 timestamp) = getTokenPrice(token);
        bool fresh = block.timestamp <= timestamp ? true : block.timestamp - timestamp <= maxStaleness;

        uint256 confidence = fresh ? 100 : 50;
        uint256 finalPrice = chainlinkPrice;

        uint256 refPrice = _referencePrice[token];
        if (refPrice > 0) {
            (, uint256 deviationBps) = validatePriceDeviation(chainlinkPrice, refPrice, MAX_BPS);
            if (deviationBps > 200) {
                confidence = confidence > 20 ? confidence - 20 : 0;
            } else if (deviationBps > 100) {
                confidence = confidence > 10 ? confidence - 10 : 0;
            }
        }

        if (confidence > 100) {
            confidence = 100;
        }

        if (confidence < minConfidencePercent) {
            // retain lowered confidence to signal discrepancy
        }

        return (finalPrice, confidence);
    }

    function getBTCPrice() external view returns (uint256, uint256) {
        return getTokenPrice(_alias("BTC"));
    }

    function getETHPrice() external view returns (uint256, uint256) {
        return getTokenPrice(_alias("ETH"));
    }

    function getUSDCPrice() external view returns (uint256, uint256) {
        return getTokenPrice(_alias("USDC"));
    }

    function getWBTCPrice() external view returns (uint256, uint256) {
        return getTokenPrice(_alias("WBTC"));
    }

    function _alias(string memory symbol) private view returns (address token) {
        token = _aliasToken[keccak256(bytes(symbol))];
        require(token != address(0), "Alias token missing");
    }

    function _poolKey(address tokenIn, address tokenOut, uint24 fee) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut, fee));
    }
}
