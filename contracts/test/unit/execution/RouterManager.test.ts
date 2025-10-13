import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployRouterManagerFixture } from "../../fixtures/deployments";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";
import { Venue, ROLES } from "../../helpers/constants";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * RouterManager Contract Tests
 *
 * Tests cover:
 * - Adapter registration and management
 * - Route selection logic
 * - Adapter failure handling
 * - Access control
 * - Adapter prioritization and fallback
 */
describe("RouterManager", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "RouterManager");
  });

  describe("Deployment and Initialization", function () {
    it("should deploy with correct DcaManager reference", async function () {
      const { routerManager, dcaManager } = await loadFixture(deployRouterManagerFixture);

      expect(await routerManager.dcaManager()).to.equal(await dcaManager.getAddress());
    });

    it("should initialize with no adapters", async function () {
      const { routerManager } = await loadFixture(deployRouterManagerFixture);

      const adapterCount = await routerManager.getAdapterCount();

      expect(adapterCount).to.equal(0);
    });
  });

  describe("Adapter Registration", function () {
    it("should register UniV3 adapter", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await expect(
        routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY)
      )
        .to.emit(routerManager, "RouterAdapterAdded")
        .withArgs(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);
    });

    it("should register CoW adapter", async function () {
      const { routerManager, cowAdapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await expect(
        routerManager.connect(deployer).addRouterAdapter(await cowAdapter.getAddress(), Venue.COW_ONLY)
      )
        .to.emit(routerManager, "RouterAdapterAdded")
        .withArgs(await cowAdapter.getAddress(), Venue.COW_ONLY);
    });

    it("should register 1inch adapter", async function () {
      const { routerManager, oneInchAdapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await expect(
        routerManager.connect(deployer).addRouterAdapter(await oneInchAdapter.getAddress(), Venue.AGGREGATOR)
      )
        .to.emit(routerManager, "RouterAdapterAdded")
        .withArgs(await oneInchAdapter.getAddress(), Venue.AGGREGATOR);
    });

    it("should track registered adapters", async function () {
      const { routerManager, uniV3Adapter, cowAdapter, oneInchAdapter, deployer } =
        await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await cowAdapter.getAddress(), Venue.COW_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await oneInchAdapter.getAddress(), Venue.AGGREGATOR);

      const adapterCount = await routerManager.getAdapterCount();

      expect(adapterCount).to.equal(3);
    });

    it("should store adapter by venue", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      const storedAdapter = await routerManager.getAdapter(Venue.UNIV3_ONLY);

      expect(storedAdapter).to.equal(await uniV3Adapter.getAddress());
    });

    it("should revert if adapter address is zero", async function () {
      const { routerManager, deployer } = await loadFixture(deployRouterManagerFixture);

      await expect(
        routerManager.connect(deployer).addRouterAdapter(ethers.ZeroAddress, Venue.UNIV3_ONLY)
      ).to.be.revertedWith("Invalid adapter address");
    });

    it("should revert if adapter already registered for venue", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      await expect(
        routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY)
      ).to.be.revertedWith("Adapter already registered");
    });

    it("should revert if non-admin tries to register", async function () {
      const { routerManager, uniV3Adapter, user1 } = await loadFixture(deployRouterManagerFixture);

      await expect(
        routerManager.connect(user1).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY)
      ).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("Adapter Updates", function () {
    it("should update adapter for venue", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      // Register initial adapter
      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      // Create new adapter address (for testing)
      const newAdapterAddress = ethers.Wallet.createRandom().address;

      await expect(
        routerManager.connect(deployer).updateRouterAdapter(newAdapterAddress, Venue.UNIV3_ONLY)
      )
        .to.emit(routerManager, "RouterAdapterUpdated")
        .withArgs(newAdapterAddress, Venue.UNIV3_ONLY);
    });

    it("should retrieve updated adapter", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      const newAdapterAddress = ethers.Wallet.createRandom().address;
      await routerManager.connect(deployer).updateRouterAdapter(newAdapterAddress, Venue.UNIV3_ONLY);

      const storedAdapter = await routerManager.getAdapter(Venue.UNIV3_ONLY);

      expect(storedAdapter).to.equal(newAdapterAddress);
    });

    it("should revert if no adapter registered for venue", async function () {
      const { routerManager, deployer } = await loadFixture(deployRouterManagerFixture);

      const newAdapterAddress = ethers.Wallet.createRandom().address;

      await expect(
        routerManager.connect(deployer).updateRouterAdapter(newAdapterAddress, Venue.UNIV3_ONLY)
      ).to.be.revertedWith("No adapter registered");
    });
  });

  describe("Adapter Removal", function () {
    it("should remove adapter from venue", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      await expect(routerManager.connect(deployer).removeRouterAdapter(Venue.UNIV3_ONLY))
        .to.emit(routerManager, "RouterAdapterRemoved")
        .withArgs(Venue.UNIV3_ONLY);
    });

    it("should clear adapter mapping after removal", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);
      await routerManager.connect(deployer).removeRouterAdapter(Venue.UNIV3_ONLY);

      const storedAdapter = await routerManager.getAdapter(Venue.UNIV3_ONLY);

      expect(storedAdapter).to.equal(ethers.ZeroAddress);
    });

    it("should decrement adapter count on removal", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      const countBefore = await routerManager.getAdapterCount();

      await routerManager.connect(deployer).removeRouterAdapter(Venue.UNIV3_ONLY);

      const countAfter = await routerManager.getAdapterCount();

      expect(countBefore - countAfter).to.equal(1);
    });

    it("should revert if no adapter to remove", async function () {
      const { routerManager, deployer } = await loadFixture(deployRouterManagerFixture);

      await expect(
        routerManager.connect(deployer).removeRouterAdapter(Venue.UNIV3_ONLY)
      ).to.be.revertedWith("No adapter registered");
    });
  });

  describe("Route Selection", function () {
    it("should select AUTO route for small amounts", async function () {
      const { routerManager, uniV3Adapter, cowAdapter, oneInchAdapter, tokens, deployer } =
        await loadFixture(deployRouterManagerFixture);

      // Register all adapters
      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await cowAdapter.getAddress(), Venue.COW_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await oneInchAdapter.getAddress(), Venue.AGGREGATOR);

      const smallAmount = ethers.parseUnits("100", 6); // $100

      const selectedVenue = await routerManager.selectOptimalRoute(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        smallAmount,
        Venue.AUTO
      );

      // For small amounts, should select UniV3
      expect(selectedVenue).to.equal(Venue.UNIV3_ONLY);
    });

    it("should select CoW for large amounts (≥$5k)", async function () {
      const { routerManager, uniV3Adapter, cowAdapter, oneInchAdapter, tokens, deployer } =
        await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await cowAdapter.getAddress(), Venue.COW_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await oneInchAdapter.getAddress(), Venue.AGGREGATOR);

      const largeAmount = ethers.parseUnits("5000", 6); // $5,000

      const selectedVenue = await routerManager.selectOptimalRoute(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        largeAmount,
        Venue.AUTO
      );

      // For large amounts, should select CoW
      expect(selectedVenue).to.equal(Venue.COW_ONLY);
    });

    it("should respect venue override", async function () {
      const { routerManager, uniV3Adapter, cowAdapter, tokens, deployer } =
        await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await cowAdapter.getAddress(), Venue.COW_ONLY);

      const amount = ethers.parseUnits("100", 6);

      // Force CoW even for small amount
      const selectedVenue = await routerManager.selectOptimalRoute(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amount,
        Venue.COW_ONLY
      );

      expect(selectedVenue).to.equal(Venue.COW_ONLY);
    });

    it("should return route data for selected venue", async function () {
      const { routerManager, uniV3Adapter, tokens, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      const amount = ethers.parseUnits("100", 6);

      const [venue, routeData] = await routerManager.getRouteData(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amount,
        Venue.AUTO
      );

      expect(venue).to.equal(Venue.UNIV3_ONLY);
      expect(routeData).to.not.be.empty;
    });
  });

  describe("Adapter Failure Handling", function () {
    it("should fall back to 1inch when primary adapter fails", async function () {
      const { routerManager, uniV3Adapter, cowAdapter, oneInchAdapter, tokens, deployer } =
        await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await cowAdapter.getAddress(), Venue.COW_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await oneInchAdapter.getAddress(), Venue.AGGREGATOR);

      const amount = ethers.parseUnits("100", 6);

      // Simulate UniV3 failure
      await routerManager.setAdapterStatus(Venue.UNIV3_ONLY, false);

      const selectedVenue = await routerManager.selectOptimalRoute(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amount,
        Venue.AUTO
      );

      // Should fall back to 1inch
      expect(selectedVenue).to.equal(Venue.AGGREGATOR);
    });

    it("should track adapter health status", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      // Initially healthy
      expect(await routerManager.isAdapterHealthy(Venue.UNIV3_ONLY)).to.be.true;

      // Mark as unhealthy
      await routerManager.setAdapterStatus(Venue.UNIV3_ONLY, false);

      expect(await routerManager.isAdapterHealthy(Venue.UNIV3_ONLY)).to.be.false;
    });

    it("should emit event on adapter failure", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      await expect(routerManager.setAdapterStatus(Venue.UNIV3_ONLY, false))
        .to.emit(routerManager, "AdapterStatusChanged")
        .withArgs(Venue.UNIV3_ONLY, false);
    });

    it("should skip unhealthy adapters in selection", async function () {
      const { routerManager, uniV3Adapter, cowAdapter, tokens, deployer } =
        await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await cowAdapter.getAddress(), Venue.COW_ONLY);

      // Mark UniV3 as unhealthy
      await routerManager.setAdapterStatus(Venue.UNIV3_ONLY, false);

      const amount = ethers.parseUnits("100", 6);

      const selectedVenue = await routerManager.selectOptimalRoute(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amount,
        Venue.AUTO
      );

      // Should not select unhealthy UniV3
      expect(selectedVenue).to.not.equal(Venue.UNIV3_ONLY);
    });
  });

  describe("Access Control", function () {
    it("should grant router admin role to deployer", async function () {
      const { routerManager, deployer } = await loadFixture(deployRouterManagerFixture);

      expect(await routerManager.hasRole(ROLES.ROUTER_ADMIN, deployer.address)).to.be.true;
    });

    it("should allow admin to grant router admin role", async function () {
      const { routerManager, deployer, user1 } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).grantRole(ROLES.ROUTER_ADMIN, user1.address);

      expect(await routerManager.hasRole(ROLES.ROUTER_ADMIN, user1.address)).to.be.true;
    });

    it("should only allow router admin to add adapters", async function () {
      const { routerManager, uniV3Adapter, user1 } = await loadFixture(deployRouterManagerFixture);

      await expect(
        routerManager.connect(user1).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY)
      ).to.be.revertedWith("AccessControl: account");
    });

    it("should only allow router admin to remove adapters", async function () {
      const { routerManager, uniV3Adapter, deployer, user1 } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      await expect(
        routerManager.connect(user1).removeRouterAdapter(Venue.UNIV3_ONLY)
      ).to.be.revertedWith("AccessControl: account");
    });

    it("should only allow router admin to update adapter status", async function () {
      const { routerManager, uniV3Adapter, deployer, user1 } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      await expect(
        routerManager.connect(user1).setAdapterStatus(Venue.UNIV3_ONLY, false)
      ).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("Adapter Query Functions", function () {
    it("should list all registered adapters", async function () {
      const { routerManager, uniV3Adapter, cowAdapter, deployer } =
        await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);
      await routerManager.connect(deployer).addRouterAdapter(await cowAdapter.getAddress(), Venue.COW_ONLY);

      const adapters = await routerManager.getAllAdapters();

      expect(adapters.length).to.equal(2);
      expect(adapters).to.include(await uniV3Adapter.getAddress());
      expect(adapters).to.include(await cowAdapter.getAddress());
    });

    it("should check if venue has adapter", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      expect(await routerManager.hasAdapter(Venue.UNIV3_ONLY)).to.be.false;

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      expect(await routerManager.hasAdapter(Venue.UNIV3_ONLY)).to.be.true;
    });

    it("should get adapter info", async function () {
      const { routerManager, uniV3Adapter, deployer } = await loadFixture(deployRouterManagerFixture);

      await routerManager.connect(deployer).addRouterAdapter(await uniV3Adapter.getAddress(), Venue.UNIV3_ONLY);

      const adapterInfo = await routerManager.getAdapterInfo(Venue.UNIV3_ONLY);

      expect(adapterInfo.adapterAddress).to.equal(await uniV3Adapter.getAddress());
      expect(adapterInfo.venue).to.equal(Venue.UNIV3_ONLY);
      expect(adapterInfo.isHealthy).to.be.true;
    });
  });
});
