// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {ERC721URIStorageUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Roles} from "../libraries/Roles.sol";

interface IPositionTransferHook {
    function onPositionTransfer(uint256 positionId, address from, address to) external;
}

/**
 * @title PositionNFT
 * @notice ERC-721 token representing ownership of a DCA position.
 */
contract PositionNFT is
    Initializable,
    ERC721Upgradeable,
    ERC721EnumerableUpgradeable,
    ERC721URIStorageUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    string public baseURI;
    address public positionStorage;
    address public manager;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        address positionStorage_
    ) external initializer {
        require(positionStorage_ != address(0), "Invalid storage");

        __ERC721_init(name_, symbol_);
        __ERC721Enumerable_init();
        __ERC721URIStorage_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        baseURI = "";
        positionStorage = positionStorage_;

        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
    }

    function setManager(address manager_) external onlyRole(Roles.DEFAULT_ADMIN) {
        require(manager_ != address(0), "Invalid manager");
        manager = manager_;
    }

    function mint(address to, uint256 tokenId) external onlyRole(Roles.MINTER) {
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) external onlyRole(Roles.BURNER) {
        _burn(tokenId);
    }

    function setBaseURI(string memory newBaseURI) external onlyRole(Roles.DEFAULT_ADMIN) {
        baseURI = newBaseURI;
    }

    function setTokenURI(uint256 tokenId, string calldata tokenURI_) external onlyRole(Roles.METADATA) {
        _requireOwned(tokenId);
        _setTokenURI(tokenId, tokenURI_);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(
            ERC721Upgradeable,
            ERC721EnumerableUpgradeable,
            ERC721URIStorageUpgradeable,
            AccessControlUpgradeable
        )
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable)
        returns (address)
    {
        address previousOwner = super._update(to, tokenId, auth);

        if (manager != address(0)) {
            IPositionTransferHook(manager).onPositionTransfer(tokenId, previousOwner, to);
        }

        return previousOwner;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function _increaseBalance(address account, uint128 amount)
        internal
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable)
    {
        super._increaseBalance(account, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(Roles.DEFAULT_ADMIN) {}
}
