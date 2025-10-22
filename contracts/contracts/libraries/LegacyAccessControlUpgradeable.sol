// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title LegacyAccessControlUpgradeable
 * @notice Extends AccessControlUpgradeable but keeps the v4.x revert strings
 *         so the existing unit tests that assert on revert reasons continue to pass.
 */
abstract contract LegacyAccessControlUpgradeable is AccessControlUpgradeable {
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
