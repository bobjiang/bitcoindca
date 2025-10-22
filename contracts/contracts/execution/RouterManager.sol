// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LegacyAccessControl} from "../libraries/LegacyAccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Roles} from "../libraries/Roles.sol";

/**
 * @title RouterManager
 * @notice Maintains the mapping between venue identifiers and their
 *         corresponding router adapters. The executor relies on this contract
 *         to resolve the correct adapter when routing a position.
 */
contract RouterManager is LegacyAccessControl, ReentrancyGuard {
    address public immutable dcaManager;

    mapping(uint16 => address) private _adapters;
    mapping(uint16 => bool) private _isRegistered;
    uint16[] private _registeredVenues;

    event RouterAdapterAdded(address indexed adapter, uint16 indexed venue);
    event RouterAdapterUpdated(address indexed adapter, uint16 indexed venue);
    event RouterAdapterRemoved(uint16 indexed venue);

    constructor(address dcaManager_) {
        require(dcaManager_ != address(0), "Invalid DcaManager");
        dcaManager = dcaManager_;

        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
        _grantRole(Roles.ROUTER_ADMIN, msg.sender);
    }

    /**
     * @notice Registers a new adapter for `venue`.
     */
    function addRouterAdapter(address adapter, uint16 venue) external onlyRole(Roles.ROUTER_ADMIN) nonReentrant {
        require(adapter != address(0), "Invalid adapter address");
        require(!_isRegistered[venue], "Adapter already registered");

        _adapters[venue] = adapter;
        _isRegistered[venue] = true;
        _registeredVenues.push(venue);

        emit RouterAdapterAdded(adapter, venue);
    }

    /**
     * @notice Updates the adapter associated with `venue`.
     */
    function updateRouterAdapter(address adapter, uint16 venue) external onlyRole(Roles.ROUTER_ADMIN) nonReentrant {
        require(_isRegistered[venue], "No adapter registered");
        require(adapter != address(0), "Invalid adapter address");

        _adapters[venue] = adapter;
        emit RouterAdapterUpdated(adapter, venue);
    }

    /**
     * @notice Removes the adapter mapping for `venue`.
     */
    function removeRouterAdapter(uint16 venue) external onlyRole(Roles.ROUTER_ADMIN) nonReentrant {
        require(_isRegistered[venue], "No adapter registered");

        delete _adapters[venue];
        _isRegistered[venue] = false;
        _removeVenue(venue);

        emit RouterAdapterRemoved(venue);
    }

    /**
     * @return adapter The adapter address registered for `venue`.
     */
    function getAdapter(uint16 venue) external view returns (address adapter) {
        adapter = _adapters[venue];
    }

    /**
     * @return count The number of registered venues.
     */
    function getAdapterCount() external view returns (uint256 count) {
        count = _registeredVenues.length;
    }

    /**
     * @return list The list of registered venue identifiers.
     */
    function registeredVenues() external view returns (uint16[] memory list) {
        list = _registeredVenues;
    }

    function _removeVenue(uint16 venue) private {
        uint256 length = _registeredVenues.length;
        for (uint256 i = 0; i < length; i++) {
            if (_registeredVenues[i] == venue) {
                if (i != length - 1) {
                    _registeredVenues[i] = _registeredVenues[length - 1];
                }
                _registeredVenues.pop();
                break;
            }
        }
    }
}
