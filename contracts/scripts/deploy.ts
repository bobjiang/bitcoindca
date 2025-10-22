import { ethers, upgrades } from "hardhat";
import { getNetworkAddresses } from "../utils/constants";

/**
 * Example deployment script for upgradeable contracts
 * This demonstrates the pattern for deploying UUPS proxies with OpenZeppelin
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
  console.log("Network:", network.name, "Chain ID:", chainId);

  // Get network-specific addresses
  const addresses = getNetworkAddresses(chainId);
  console.log("Using addresses for network:", addresses);

  // Example: Deploy a UUPS upgradeable contract
  // Uncomment when you have actual contracts to deploy

  /*
  console.log("\nDeploying DcaManager...");
  const DcaManager = await ethers.getContractFactory("DcaManager");
  const dcaManager = await upgrades.deployProxy(
    DcaManager,
    [
      deployer.address, // initial owner
      addresses.WBTC,
      addresses.USDC,
      addresses.PERMIT2,
    ],
    {
      kind: "uups",
      initializer: "initialize",
    }
  );
  await dcaManager.waitForDeployment();
  const dcaManagerAddress = await dcaManager.getAddress();
  console.log("DcaManager deployed to:", dcaManagerAddress);

  console.log("\nDeploying PositionNFT...");
  const PositionNFT = await ethers.getContractFactory("PositionNFT");
  const positionNFT = await upgrades.deployProxy(
    PositionNFT,
    [
      dcaManagerAddress,
      "DCA Crypto Position",
      "BTCDCA",
    ],
    {
      kind: "uups",
      initializer: "initialize",
    }
  );
  await positionNFT.waitForDeployment();
  console.log("PositionNFT deployed to:", await positionNFT.getAddress());

  // Save deployment addresses
  console.log("\n=== Deployment Summary ===");
  console.log("DcaManager:", dcaManagerAddress);
  console.log("PositionNFT:", await positionNFT.getAddress());
  console.log("========================\n");
  */

  console.log("\nNo contracts to deploy yet. Add your contract deployments above.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
