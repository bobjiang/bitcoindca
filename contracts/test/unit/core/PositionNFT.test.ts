import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployBaseSystemFixture, deployWithPositionFixture } from "../../fixtures/deployments";
import { ROLES } from "../../helpers/constants";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * PositionNFT Contract Tests
 *
 * Tests cover:
 * - NFT minting and burning
 * - Token metadata and URIs
 * - Token transfers
 * - Access control for minting/burning
 * - Integration with PositionStorage
 * - ERC-721 compliance
 */
describe("PositionNFT", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "PositionNFT");
    await ensureArtifactOrSkip(this, "PositionStorage");
  });
  describe("Deployment and Initialization", function () {
    it("should deploy with correct name and symbol", async function () {
      const { positionNFT } = await loadFixture(deployBaseSystemFixture);

      expect(await positionNFT.name()).to.equal("Bitcoin DCA Position");
      expect(await positionNFT.symbol()).to.equal("BDCA");
    });

    it("should link to position storage", async function () {
      const { positionNFT, positionStorage } = await loadFixture(deployBaseSystemFixture);

      expect(await positionNFT.positionStorage()).to.equal(await positionStorage.getAddress());
    });

    it("should grant deployer admin role", async function () {
      const { positionNFT, deployer } = await loadFixture(deployBaseSystemFixture);

      expect(await positionNFT.hasRole(ROLES.DEFAULT_ADMIN, deployer.address)).to.be.true;
    });
  });

  describe("Minting", function () {
    it("should allow minter role to mint NFT", async function () {
      const { positionNFT, dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      const tokenId = 1;

      await expect(positionNFT.connect(dcaManager).mint(user1.address, tokenId))
        .to.emit(positionNFT, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, tokenId);

      expect(await positionNFT.ownerOf(tokenId)).to.equal(user1.address);
      expect(await positionNFT.balanceOf(user1.address)).to.equal(1);
    });

    it("should increment total supply on mint", async function () {
      const { positionNFT, dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      const supplyBefore = await positionNFT.totalSupply();

      await positionNFT.connect(dcaManager).mint(user1.address, 1);

      const supplyAfter = await positionNFT.totalSupply();

      expect(supplyAfter - supplyBefore).to.equal(1);
    });

    it("should revert if non-minter tries to mint", async function () {
      const { positionNFT, user1 } = await loadFixture(deployBaseSystemFixture);

      await expect(positionNFT.connect(user1).mint(user1.address, 1)).to.be.revertedWith(
        "AccessControl: account"
      );
    });

    it("should revert if minting to zero address", async function () {
      const { positionNFT, dcaManager } = await loadFixture(deployBaseSystemFixture);

      await expect(
        positionNFT.connect(dcaManager).mint(ethers.ZeroAddress, 1)
      ).to.be.revertedWith("ERC721: mint to the zero address");
    });

    it("should revert if token already exists", async function () {
      const { positionNFT, dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      await positionNFT.connect(dcaManager).mint(user1.address, 1);

      await expect(positionNFT.connect(dcaManager).mint(user1.address, 1)).to.be.revertedWith(
        "ERC721: token already minted"
      );
    });
  });

  describe("Burning", function () {
    it("should allow burner role to burn NFT", async function () {
      const { positionNFT, dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      await positionNFT.connect(dcaManager).mint(user1.address, 1);

      await expect(positionNFT.connect(dcaManager).burn(1))
        .to.emit(positionNFT, "Transfer")
        .withArgs(user1.address, ethers.ZeroAddress, 1);

      await expect(positionNFT.ownerOf(1)).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("should decrement total supply on burn", async function () {
      const { positionNFT, dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      await positionNFT.connect(dcaManager).mint(user1.address, 1);

      const supplyBefore = await positionNFT.totalSupply();

      await positionNFT.connect(dcaManager).burn(1);

      const supplyAfter = await positionNFT.totalSupply();

      expect(supplyBefore - supplyAfter).to.equal(1);
    });

    it("should revert if non-burner tries to burn", async function () {
      const { positionNFT, dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      await positionNFT.connect(dcaManager).mint(user1.address, 1);

      await expect(positionNFT.connect(user1).burn(1)).to.be.revertedWith("AccessControl: account");
    });

    it("should revert if token does not exist", async function () {
      const { positionNFT, dcaManager } = await loadFixture(deployBaseSystemFixture);

      await expect(positionNFT.connect(dcaManager).burn(999)).to.be.revertedWith(
        "ERC721: invalid token ID"
      );
    });
  });

  describe("Token Metadata", function () {
    it("should return token URI", async function () {
      const { positionNFT, positionId } = await loadFixture(deployWithPositionFixture);

      const uri = await positionNFT.tokenURI(positionId);

      expect(uri).to.not.be.empty;
    });

    it("should allow metadata role to set token URI", async function () {
      const { positionNFT, positionId, deployer } = await loadFixture(deployWithPositionFixture);

      await positionNFT.grantRole(ROLES.METADATA, deployer.address);

      const customURI = "ipfs://QmCustomHash";

      await positionNFT.connect(deployer).setTokenURI(positionId, customURI);

      expect(await positionNFT.tokenURI(positionId)).to.equal(customURI);
    });

    it("should allow admin to set base URI", async function () {
      const { positionNFT, deployer } = await loadFixture(deployBaseSystemFixture);

      const baseURI = "https://api.bitcoindca.com/metadata/";

      await positionNFT.connect(deployer).setBaseURI(baseURI);

      // Verify base URI is set (will be prepended to token URIs)
      expect(await positionNFT.baseURI()).to.equal(baseURI);
    });

    it("should revert if getting URI for non-existent token", async function () {
      const { positionNFT } = await loadFixture(deployBaseSystemFixture);

      await expect(positionNFT.tokenURI(999)).to.be.revertedWith(
        "ERC721: invalid token ID"
      );
    });
  });

  describe("Token Transfers", function () {
    it("should allow owner to transfer NFT", async function () {
      const { positionNFT, positionId, user1, user2 } = await loadFixture(deployWithPositionFixture);

      await expect(
        positionNFT.connect(user1).transferFrom(user1.address, user2.address, positionId)
      )
        .to.emit(positionNFT, "Transfer")
        .withArgs(user1.address, user2.address, positionId);

      expect(await positionNFT.ownerOf(positionId)).to.equal(user2.address);
    });

    it("should allow approved address to transfer NFT", async function () {
      const { positionNFT, positionId, user1, user2 } = await loadFixture(deployWithPositionFixture);

      await positionNFT.connect(user1).approve(user2.address, positionId);

      await expect(
        positionNFT.connect(user2).transferFrom(user1.address, user2.address, positionId)
      )
        .to.emit(positionNFT, "Transfer")
        .withArgs(user1.address, user2.address, positionId);

      expect(await positionNFT.ownerOf(positionId)).to.equal(user2.address);
    });

    it("should allow operator to transfer NFT", async function () {
      const { positionNFT, positionId, user1, user2 } = await loadFixture(deployWithPositionFixture);

      await positionNFT.connect(user1).setApprovalForAll(user2.address, true);

      await expect(
        positionNFT.connect(user2).transferFrom(user1.address, user2.address, positionId)
      )
        .to.emit(positionNFT, "Transfer")
        .withArgs(user1.address, user2.address, positionId);

      expect(await positionNFT.ownerOf(positionId)).to.equal(user2.address);
    });

    it("should update balances after transfer", async function () {
      const { positionNFT, positionId, user1, user2 } = await loadFixture(deployWithPositionFixture);

      const user1BalanceBefore = await positionNFT.balanceOf(user1.address);
      const user2BalanceBefore = await positionNFT.balanceOf(user2.address);

      await positionNFT.connect(user1).transferFrom(user1.address, user2.address, positionId);

      const user1BalanceAfter = await positionNFT.balanceOf(user1.address);
      const user2BalanceAfter = await positionNFT.balanceOf(user2.address);

      expect(user1BalanceBefore - user1BalanceAfter).to.equal(1);
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(1);
    });

    it("should revert if transferring to zero address", async function () {
      const { positionNFT, positionId, user1 } = await loadFixture(deployWithPositionFixture);

      await expect(
        positionNFT.connect(user1).transferFrom(user1.address, ethers.ZeroAddress, positionId)
      ).to.be.revertedWith("ERC721: transfer to the zero address");
    });

    it("should revert if unauthorized transfer", async function () {
      const { positionNFT, positionId, user2 } = await loadFixture(deployWithPositionFixture);

      await expect(
        positionNFT.connect(user2).transferFrom(user2.address, user2.address, positionId)
      ).to.be.revertedWith("ERC721: caller is not token owner or approved");
    });
  });

  describe("Position Data Integration", function () {
    it("should retrieve position data from storage", async function () {
      const { positionNFT, positionId, createParams } = await loadFixture(deployWithPositionFixture);

      const positionData = await positionNFT.getPositionData(positionId);

      expect(positionData.owner).to.equal(createParams.owner);
      expect(positionData.quoteToken).to.equal(createParams.quoteToken);
      expect(positionData.isBuy).to.equal(createParams.isBuy);
    });

    it("should validate position existence", async function () {
      const { positionNFT, positionId } = await loadFixture(deployWithPositionFixture);

      expect(await positionNFT.isValidPosition(positionId)).to.be.true;
      expect(await positionNFT.isValidPosition(999)).to.be.false;
    });
  });

  describe("Enumeration", function () {
    it("should track tokens by owner", async function () {
      const { positionNFT, dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      await positionNFT.connect(dcaManager).mint(user1.address, 1);
      await positionNFT.connect(dcaManager).mint(user1.address, 2);
      await positionNFT.connect(dcaManager).mint(user1.address, 3);

      expect(await positionNFT.balanceOf(user1.address)).to.equal(3);
      expect(await positionNFT.tokenOfOwnerByIndex(user1.address, 0)).to.equal(1);
      expect(await positionNFT.tokenOfOwnerByIndex(user1.address, 1)).to.equal(2);
      expect(await positionNFT.tokenOfOwnerByIndex(user1.address, 2)).to.equal(3);
    });

    it("should track all tokens", async function () {
      const { positionNFT, dcaManager, user1, user2 } = await loadFixture(deployBaseSystemFixture);

      await positionNFT.connect(dcaManager).mint(user1.address, 1);
      await positionNFT.connect(dcaManager).mint(user2.address, 2);

      expect(await positionNFT.totalSupply()).to.equal(2);
      expect(await positionNFT.tokenByIndex(0)).to.equal(1);
      expect(await positionNFT.tokenByIndex(1)).to.equal(2);
    });
  });

  describe("Access Control", function () {
    it("should allow admin to grant minter role", async function () {
      const { positionNFT, deployer, user1 } = await loadFixture(deployBaseSystemFixture);

      await positionNFT.connect(deployer).grantRole(ROLES.MINTER, user1.address);

      expect(await positionNFT.hasRole(ROLES.MINTER, user1.address)).to.be.true;
    });

    it("should allow admin to revoke burner role", async function () {
      const { positionNFT, dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);

      await positionNFT.connect(deployer).revokeRole(ROLES.BURNER, await dcaManager.getAddress());

      expect(
        await positionNFT.hasRole(ROLES.BURNER, await dcaManager.getAddress())
      ).to.be.false;
    });

    it("should revert if non-admin tries to grant roles", async function () {
      const { positionNFT, user1, user2 } = await loadFixture(deployBaseSystemFixture);

      await expect(
        positionNFT.connect(user1).grantRole(ROLES.MINTER, user2.address)
      ).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("ERC-721 Compliance", function () {
    it("should support ERC-721 interface", async function () {
      const { positionNFT } = await loadFixture(deployBaseSystemFixture);

      const ERC721_INTERFACE_ID = "0x80ac58cd";

      expect(await positionNFT.supportsInterface(ERC721_INTERFACE_ID)).to.be.true;
    });

    it("should support ERC-721 Metadata interface", async function () {
      const { positionNFT } = await loadFixture(deployBaseSystemFixture);

      const ERC721_METADATA_INTERFACE_ID = "0x5b5e139f";

      expect(await positionNFT.supportsInterface(ERC721_METADATA_INTERFACE_ID)).to.be.true;
    });

    it("should support ERC-721 Enumerable interface", async function () {
      const { positionNFT } = await loadFixture(deployBaseSystemFixture);

      const ERC721_ENUMERABLE_INTERFACE_ID = "0x780e9d63";

      expect(await positionNFT.supportsInterface(ERC721_ENUMERABLE_INTERFACE_ID)).to.be.true;
    });
  });

  describe("Upgradeability", function () {
    it("should be upgradeable via UUPS", async function () {
      const { positionNFT, deployer } = await loadFixture(deployBaseSystemFixture);

      const PositionNFTV2 = await ethers.getContractFactory("PositionNFT", deployer);

      // This should not revert
      await expect(
        positionNFT.connect(deployer).upgradeTo(await PositionNFTV2.getAddress())
      ).to.not.be.reverted;
    });

    it("should revert if non-admin tries to upgrade", async function () {
      const { positionNFT, user1 } = await loadFixture(deployBaseSystemFixture);

      const randomAddress = ethers.Wallet.createRandom().address;

      await expect(
        positionNFT.connect(user1).upgradeTo(randomAddress)
      ).to.be.revertedWith("AccessControl: account");
    });
  });
});
