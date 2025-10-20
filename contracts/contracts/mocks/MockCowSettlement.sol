// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockCowSettlement
 * @notice Minimal settlement contract used by the CoW adapter tests. The
 *         contract keeps track of funds that have been locked for settlement
 *         and allows authorised callers to release those funds back to users.
 *         It intentionally omits any complex auction logic – the adapter under
 *         test is responsible for orchestrating the happy path behaviour.
 */
contract MockCowSettlement {
    mapping(address owner => mapping(address token => uint256 amount)) private _locked;

    event FundsLocked(address indexed owner, address indexed token, uint256 amount);
    event FundsReleased(address indexed owner, address indexed token, address indexed to, uint256 amount);

    /**
     * @notice Locks `amount` of `token` on behalf of `owner`. The token must
     *         have been approved for transfer by `owner` before calling.
     */
    function lockFunds(address owner, address token, uint256 amount) external {
        if (owner == address(0) || token == address(0)) revert("Invalid parameters");
        if (amount == 0) revert("Zero amount");

        IERC20(token).transferFrom(owner, address(this), amount);
        _locked[owner][token] += amount;

        emit FundsLocked(owner, token, amount);
    }

    /**
     * @notice Releases locked funds back to `to`. Used by tests to emulate the
     *         CoW settlement contract paying out executed orders.
     */
    function releaseFunds(address owner, address token, uint256 amount, address to) external {
        if (to == address(0)) revert("Invalid recipient");
        uint256 lockedAmount = _locked[owner][token];
        require(lockedAmount >= amount, "Insufficient locked funds");

        _locked[owner][token] = lockedAmount - amount;
        IERC20(token).transfer(to, amount);

        emit FundsReleased(owner, token, to, amount);
    }

    /**
     * @notice Returns the amount of `token` currently locked for `owner`.
     */
    function lockedFunds(address owner, address token) external view returns (uint256) {
        return _locked[owner][token];
    }
}
