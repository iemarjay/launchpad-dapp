import {ethers, upgrades} from "hardhat";

async function main() {
  console.log("Starting deployment of LaunchpadV2...");

  const [deployer] = await ethers.getSigners();

  // Get the LaunchpadV2 contract factory
  const LaunchpadV2 = await ethers.getContractFactory("LaunchpadContractV2");
  console.log("Deploying LaunchpadV2...");

  // Initialize parameters
  const launchFee = ethers.parseEther("0.1"); // 0.1 ETH launch fee
  const saleFee = 300; // 3% sale fee (in basis points)
  const purchaseFee = 300; // 3% purchase fee (in basis points)

  // Deploy as upgradeable contract
  const launchpad = await upgrades.deployProxy(
    LaunchpadV2,
    [
      deployer.address,
      launchFee,
      saleFee,
      purchaseFee
    ],
    {
      initializer: "initialize",
      kind: "uups"
    }
  );

  await launchpad.waitForDeployment();
  console.log("LaunchpadV2 deployed to:", launchpad.target);

  // Verify implementation
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    launchpad.target as string
  );
  console.log("Implementation address:", implementationAddress);

  // Set up initial configuration
  console.log("Setting up initial configuration...");

  // Set min tx fee
  const minTxFee = ethers.parseEther("0.001"); // 0.001 ETH min tx fee
  await launchpad.setMinTxFee(minTxFee);
  console.log("Set min tx fee to:", ethers.formatEther(minTxFee), "ETH");

  // Set mint fee
  const mintFee = ethers.parseEther("0.05"); // 0.05 ETH mint fee
  await launchpad.setMintFee(mintFee);
  console.log("Set mint fee to:", ethers.formatEther(mintFee), "ETH");

  // Set max purchase amount
  const maxPurchase = ethers.parseEther("100"); // 100 ETH max purchase
  await launchpad.setMaxPurchaseAmount(maxPurchase);
  console.log("Set max purchase amount to:", ethers.formatEther(maxPurchase), "ETH");

  console.log("Deployment and configuration complete!");

  // Log all contract addresses and parameters for verification
  console.log("\nDeployment Summary:");
  console.log("-------------------");
  console.log("Vault:", deployer.address);
  console.log("LaunchpadV2 Proxy:", launchpad.target);
  console.log("LaunchpadV2 Implementation:", implementationAddress);
  console.log("\nParameters:");
  console.log("Launch Fee:", ethers.formatEther(launchFee), "ETH");
  console.log("Sale Fee:", saleFee / 100, "%");
  console.log("Purchase Fee:", purchaseFee / 100, "%");
  console.log("Min Tx Fee:", ethers.formatEther(minTxFee), "ETH");
  console.log("Mint Fee:", ethers.formatEther(mintFee), "ETH");
  console.log("Max Purchase:", ethers.formatEther(maxPurchase), "ETH");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
