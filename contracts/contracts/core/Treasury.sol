// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title Treasury
 * @notice Handles fee collection, distribution and timelocked withdrawals for
 *         the DCA Crypto protocol. The implementation intentionally mirrors
 *         the behaviour asserted in the comprehensive unit test suite.
 */
contract Treasury is TimelockController, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant FEE_COLLECTOR_ROLE = keccak256("FEE_COLLECTOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct FeeConfig {
        uint16 protocolFeeBps;
        uint256 executionFeeFixedWei;
        uint16 gasPremiumBps;
        address feeCollector;
        uint16 referralFeeBpsDefault;
    }

    FeeConfig private _feeConfig;
    bool private _initialised;

    mapping(address => uint256) public totalFeesCollected;
    mapping(address => uint256) private _customReferralFeeBps;
    mapping(address => uint256) private _keeperPayments;

    uint256 public totalKeeperPayments;

    event FeeCollected(address indexed token, uint256 amount, address indexed collector);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event ProtocolFeeUpdated(uint16 previousBps, uint16 newBps);
    event ReferralFeeUpdated(uint16 previousBps, uint16 newBps);
    event FeeCollectorUpdated(address indexed previousCollector, address indexed newCollector);
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed to);
    event KeeperPaymentRegistered(address indexed keeper, uint256 amount);
    event KeeperPaymentClaimed(address indexed keeper, uint256 amount);
    event CustomReferralFeeSet(address indexed referrer, uint16 bps);

    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        if (admin != address(0)) {
            _grantRole(EMERGENCY_ROLE, admin);
            _grantRole(PAUSER_ROLE, admin);
        }
        _grantRole(TREASURER_ROLE, address(this));
        _grantRole(FEE_COLLECTOR_ROLE, address(this));
    }

    // ---------------------------------------------------------------------
    // Initialisation & configuration
    // ---------------------------------------------------------------------

    function initialize(FeeConfig calldata config) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "AccessControl: account missing role");
        require(!_initialised, "Treasury: already initialised");
        _validateFeeConfig(config);
        _feeConfig = config;
        _initialised = true;
        if (config.feeCollector != address(0)) {
            _grantRole(FEE_COLLECTOR_ROLE, config.feeCollector);
        }
    }

    function getFeeConfig() external view returns (FeeConfig memory) {
        return _feeConfig;
    }

    function setProtocolFeeBps(uint16 newBps) external onlyRole(TREASURER_ROLE) {
        require(newBps <= 100, "Treasury: protocol fee too high");
        uint16 previous = _feeConfig.protocolFeeBps;
        _feeConfig.protocolFeeBps = newBps;
        emit ProtocolFeeUpdated(previous, newBps);
    }

    function setReferralFeeBps(uint16 newBps) external onlyRole(TREASURER_ROLE) {
        require(newBps <= 10_000, "Treasury: referral fee too high");
        uint16 previous = _feeConfig.referralFeeBpsDefault;
        _feeConfig.referralFeeBpsDefault = newBps;
        emit ReferralFeeUpdated(previous, newBps);
    }

    function setFeeCollector(address newCollector) external onlyRole(TREASURER_ROLE) {
        require(newCollector != address(0), "Treasury: invalid fee collector");
        address previous = _feeConfig.feeCollector;
        _feeConfig.feeCollector = newCollector;
        if (previous != address(0) && previous != address(this)) {
            revokeRole(FEE_COLLECTOR_ROLE, previous);
        }
        _grantRole(FEE_COLLECTOR_ROLE, newCollector);
        emit FeeCollectorUpdated(previous, newCollector);
    }

    function setCustomReferralFee(address referrer, uint16 bps) external onlyRole(TREASURER_ROLE) {
        require(bps <= 10_000, "Treasury: referral fee too high");
        _customReferralFeeBps[referrer] = bps;
        emit CustomReferralFeeSet(referrer, bps);
    }

    function getReferralFeeBps(address referrer) public view returns (uint16) {
        uint256 custom = _customReferralFeeBps[referrer];
        if (custom == 0) {
            return _feeConfig.referralFeeBpsDefault;
        }
        return uint16(custom);
    }

    function calculateReferralFee(address referrer, uint256 protocolFee) external view returns (uint256) {
        uint16 bps = getReferralFeeBps(referrer);
        return (protocolFee * uint256(bps)) / 10_000;
    }

    // ---------------------------------------------------------------------
    // Fee collection & distribution
    // ---------------------------------------------------------------------

    function collectFees(address token, uint256 amount) external whenNotPaused nonReentrant onlyRole(FEE_COLLECTOR_ROLE) {
        require(amount > 0, "Treasury: zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalFeesCollected[token] += amount;
        emit FeeCollected(token, amount, msg.sender);
    }

    function distributeFees(address[] calldata recipients, uint256[] calldata amounts, address token)
        external
        whenNotPaused
        nonReentrant
        onlyRole(TREASURER_ROLE)
    {
        require(recipients.length == amounts.length, "Treasury: length mismatch");
        uint256 totalAmount;
        uint256 length = recipients.length;
        for (uint256 i = 0; i < length; i++) {
            totalAmount += amounts[i];
        }
        require(IERC20(token).balanceOf(address(this)) >= totalAmount, "Treasury: insufficient balance");

        for (uint256 i = 0; i < length; i++) {
            IERC20(token).safeTransfer(recipients[i], amounts[i]);
        }
    }

    function withdraw(address token, uint256 amount, address to) external onlyRole(TREASURER_ROLE) nonReentrant {
        require(to != address(0), "Treasury: invalid recipient");
        if (token == address(0)) {
            Address.sendValue(payable(to), amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdrawn(token, amount, to);
    }

    // ---------------------------------------------------------------------
    // Keeper incentives
    // ---------------------------------------------------------------------

    function registerKeeperPayment(address keeper, uint256 amount) external onlyRole(TREASURER_ROLE) {
        require(keeper != address(0), "Treasury: invalid keeper");
        require(amount > 0, "Treasury: zero amount");
        _keeperPayments[keeper] += amount;
        emit KeeperPaymentRegistered(keeper, amount);
    }

    function claimKeeperPayment() external nonReentrant {
        uint256 amount = _keeperPayments[msg.sender];
        require(amount > 0, "Treasury: no payment to claim");
        _keeperPayments[msg.sender] = 0;
        totalKeeperPayments += amount;
        Address.sendValue(payable(msg.sender), amount);
        emit KeeperPaymentClaimed(msg.sender, amount);
    }

    function pendingKeeperPayment(address keeper) external view returns (uint256) {
        return _keeperPayments[keeper];
    }

    // ---------------------------------------------------------------------
    // Emergency controls
    // ---------------------------------------------------------------------

    function emergencyWithdraw(address token, uint256 amount, address to) external onlyRole(EMERGENCY_ROLE) nonReentrant {
        require(to != address(0), "Treasury: invalid recipient");
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyWithdraw(token, amount, to);
    }

    function pauseContract() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpauseContract() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getTreasuryBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _validateFeeConfig(FeeConfig calldata config) private pure {
        require(config.protocolFeeBps <= 100, "Treasury: protocol fee too high");
        require(config.referralFeeBpsDefault <= 10_000, "Treasury: referral fee too high");
        require(config.feeCollector != address(0), "Treasury: invalid fee collector");
    }

    receive() external payable override {}
}
