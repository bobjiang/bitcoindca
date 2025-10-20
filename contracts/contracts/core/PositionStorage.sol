// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Roles} from "../libraries/Roles.sol";

/**
 * @title PositionStorage
 * @notice Upgradeable storage contract that preserves position metadata for off-chain consumers
 *         while allowing the DcaManager logic to evolve independently.
 */
contract PositionStorage is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    struct Metadata {
        address owner;
        address beneficiary;
        address quote;
        bool isBuy;
        uint16 frequency;
        uint16 venue;
        uint16 slippageBps;
        uint128 amountPerPeriod;
        uint64 startAt;
        uint64 endAt;
    }

    struct PositionRecord {
        Metadata metadata;
        bool exists;
    }

    mapping(uint256 => PositionRecord) private _positions;
    mapping(address => uint256[]) private _positionsByOwner;
    mapping(uint256 => uint256) private _ownerIndex; // positionId -> index within owner's array (index + 1)

    event MetadataStored(
        uint256 indexed positionId,
        address owner,
        address beneficiary,
        address quote,
        bool isBuy,
        uint16 frequency,
        uint16 venue,
        uint16 slippageBps,
        uint128 amountPerPeriod,
        uint64 startAt,
        uint64 endAt
    );
    event MetadataRemoved(uint256 indexed positionId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
    }

    function setPositionMetadata(uint256 positionId, Metadata calldata metadata) external onlyRole(Roles.DEFAULT_ADMIN) {
        require(positionId != 0, "Invalid position");
        require(metadata.owner != address(0), "Invalid owner");

        PositionRecord storage record = _positions[positionId];
        address previousOwner = record.metadata.owner;

        record.metadata = metadata;
        record.exists = true;

        if (previousOwner != metadata.owner) {
            _movePositionOwner(positionId, previousOwner, metadata.owner);
        } else if (previousOwner == address(0)) {
            _addToOwner(metadata.owner, positionId);
        }

        emit MetadataStored(
            positionId,
            metadata.owner,
            metadata.beneficiary,
            metadata.quote,
            metadata.isBuy,
            metadata.frequency,
            metadata.venue,
            metadata.slippageBps,
            metadata.amountPerPeriod,
            metadata.startAt,
            metadata.endAt
        );
    }

    function removePositionMetadata(uint256 positionId) external onlyRole(Roles.DEFAULT_ADMIN) {
        PositionRecord storage record = _positions[positionId];
        require(record.exists, "Position missing");

        address owner = record.metadata.owner;
        if (owner != address(0)) {
            _removeFromOwner(owner, positionId);
        }

        delete _positions[positionId];
        emit MetadataRemoved(positionId);
    }

    function getPositionMetadata(uint256 positionId) external view returns (Metadata memory metadata) {
        PositionRecord storage record = _positions[positionId];
        require(record.exists, "Position missing");
        return record.metadata;
    }

    function positionExists(uint256 positionId) external view returns (bool) {
        return _positions[positionId].exists;
    }

    function positionsByOwner(address owner) external view returns (uint256[] memory) {
        return _positionsByOwner[owner];
    }

    function _movePositionOwner(uint256 positionId, address previousOwner, address newOwner) private {
        if (previousOwner != address(0)) {
            _removeFromOwner(previousOwner, positionId);
        }
        _addToOwner(newOwner, positionId);
    }

    function _addToOwner(address owner, uint256 positionId) private {
        _positionsByOwner[owner].push(positionId);
        _ownerIndex[positionId] = _positionsByOwner[owner].length;
    }

    function _removeFromOwner(address owner, uint256 positionId) private {
        uint256 indexPlusOne = _ownerIndex[positionId];
        if (indexPlusOne == 0) {
            return;
        }

        uint256 index = indexPlusOne - 1;
        uint256[] storage ownerPositions = _positionsByOwner[owner];
        uint256 lastIndex = ownerPositions.length - 1;

        if (index != lastIndex) {
            uint256 movedId = ownerPositions[lastIndex];
            ownerPositions[index] = movedId;
            _ownerIndex[movedId] = index + 1;
        }

        ownerPositions.pop();
        delete _ownerIndex[positionId];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(Roles.DEFAULT_ADMIN) {}
}
