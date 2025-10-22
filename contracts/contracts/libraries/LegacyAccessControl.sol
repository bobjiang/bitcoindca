// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title LegacyAccessControl
 * @notice Mirrors the revert messaging from AccessControl v4.x so existing
 *         tests asserting on string reasons continue to pass.
 */
abstract contract LegacyAccessControl is AccessControl {
    using Strings for uint256;

    function _checkRole(bytes32 role, address account) internal view virtual override {
        if (!hasRole(role, account)) {
            revert(
                string.concat(
                    "AccessControl: account ",
                    Strings.toHexString(uint256(uint160(account)), 20),
                    " is missing role ",
                    Strings.toHexString(uint256(role), 32)
                )
            );
        }
    }
}
