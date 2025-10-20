// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockTreasury
 * @notice Simple mock treasury for testing purposes
 * @dev This is a placeholder until the real Treasury contract is implemented
 */
contract MockTreasury {
    address[] public owners;
    uint256 public required;
    uint256 public timelockDuration;

    event FeeCollected(address indexed token, uint256 amount);

    constructor(address[] memory _owners, uint256 _required, uint256 _timelockDuration) {
        require(_owners.length > 0, "Invalid owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");

        owners = _owners;
        required = _required;
        timelockDuration = _timelockDuration;
    }

    function collectFees(address token, uint256 amount) external {
        emit FeeCollected(token, amount);
    }

    receive() external payable {}
}
