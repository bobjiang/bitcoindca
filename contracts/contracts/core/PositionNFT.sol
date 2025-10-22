// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {ERC721URIStorageUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {LegacyAccessControlUpgradeable} from "../libraries/LegacyAccessControlUpgradeable.sol";
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
    LegacyAccessControlUpgradeable,
    UUPSUpgradeable
{
    string public baseURI;
    address public positionStorage;
    address public manager;
    mapping(uint256 => string) private _customTokenURIs;
    bool private _isBurning;

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

        baseURI = "https://metadata.dca-crypto.invalid/positions/";
        positionStorage = positionStorage_;

        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
    }

    function setManager(address manager_) external onlyRole(Roles.DEFAULT_ADMIN) {
        require(manager_ != address(0), "Invalid manager");
        manager = manager_;
    }

    function mint(address to, uint256 tokenId) external onlyRole(Roles.MINTER) {
        if (to == address(0)) {
            revert("ERC721: mint to the zero address");
        }
        if (_ownerOf(tokenId) != address(0)) {
            revert("ERC721: token already minted");
        }
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) external onlyRole(Roles.BURNER) {
        if (_ownerOf(tokenId) == address(0)) {
            revert("ERC721: invalid token ID");
        }
        _isBurning = true;
        _burn(tokenId);
        _isBurning = false;
        if (bytes(_customTokenURIs[tokenId]).length > 0) {
            delete _customTokenURIs[tokenId];
        }
    }

    function setBaseURI(string memory newBaseURI) external onlyRole(Roles.DEFAULT_ADMIN) {
        baseURI = newBaseURI;
    }

    function setTokenURI(uint256 tokenId, string calldata tokenURI_) external onlyRole(Roles.METADATA) {
        _requireOwned(tokenId);
        _setTokenURI(tokenId, tokenURI_);
        _customTokenURIs[tokenId] = tokenURI_;
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
        if (to == address(0) && !_isBurning) {
            revert("ERC721: transfer to the zero address");
        }
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
        if (_ownerOf(tokenId) == address(0)) {
            revert("ERC721: invalid token ID");
        }
        string memory custom = _customTokenURIs[tokenId];
        if (bytes(custom).length > 0) {
            return custom;
        }
        return string.concat(_baseURI(), Strings.toString(tokenId));
    }

    function ownerOf(uint256 tokenId)
        public
        view
        override(ERC721Upgradeable, IERC721)
        returns (address)
    {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) {
            revert("ERC721: invalid token ID");
        }
        return owner;
    }

    function transferFrom(address from, address to, uint256 tokenId)
        public
        override(ERC721Upgradeable, IERC721)
    {
        if (to == address(0)) {
            revert("ERC721: transfer to the zero address");
        }
        super.transferFrom(from, to, tokenId);
    }

    function _increaseBalance(address account, uint128 amount)
        internal
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable)
    {
        super._increaseBalance(account, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(Roles.DEFAULT_ADMIN) {}

    function _checkRole(bytes32 role, address account) internal view override {
        if (!hasRole(role, account)) {
            revert("AccessControl: account");
        }
    }
}
