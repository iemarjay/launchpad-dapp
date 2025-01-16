import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("LaunchpadContractV2", function() {
  // Fixture to deploy the contract with proxy
  async function deployProxyFixture() {
    const [owner, user1, user2] = await ethers.getSigners();

    // Deploy LaunchpadContractV2 with proxy
    const LaunchpadFactory = await ethers.getContractFactory("LaunchpadContractV2");
    const implementation = await LaunchpadFactory.deploy();
    await implementation.waitForDeployment();
    console.log("Implementation deployed at:", await implementation.getAddress());

    // Deploy proxy with initialization parameters
    const launchFee = ethers.parseEther("0.1"); // 0.1 EDU
    const saleFee = 100; // 1%
    const purchaseFee = 100; // 1%

    const launchpad = await upgrades.deployProxy(
      LaunchpadFactory,
      [
        await owner.getAddress(),
        launchFee,
        saleFee,
        purchaseFee
      ],
      {
        initializer: 'initialize',
        kind: 'uups',
        unsafeAllow: ['constructor']
      }
    );

    await launchpad.waitForDeployment();
    console.log("Proxy deployed at:", await launchpad.getAddress());

    // Verify implementation address
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(
      await launchpad.getAddress()
    );
    console.log("Implementation address from proxy:", implementationAddress);

    return {
      launchpad,
      mockVault: owner,
      owner,
      user1,
      user2,
      launchFee,
      implementation
    };
  }

  describe("Deployment", function() {
    it("Should deploy with correct initialization", async function() {
      const { launchpad, mockVault, launchFee } = await loadFixture(deployProxyFixture);

      expect(await launchpad.vault()).to.equal(await mockVault.getAddress());
      expect(await launchpad.launchFee()).to.equal(launchFee);
      expect(await launchpad.tokenCount()).to.equal(0n);
    });
  });

  describe("Token Creation", function() {
    it("Should create a new token with Quinn Ball params", async function() {
      const { launchpad, user1, launchFee } = await loadFixture(deployProxyFixture);

      // Log initial state
      console.log("Initial state:");
      console.log("Contract paused:", await launchpad.paused());
      console.log("Launch fee:", ethers.formatEther(await launchpad.launchFee()), "EDU");
      console.log("Token count:", await launchpad.tokenCount());

      const name = "Quinn Ball";
      const symbol = "ball";

      // Get predicted address
      const predictedAddress = await launchpad.guessNewTokenAddress(name, symbol);
      console.log("Predicted token address:", predictedAddress);

      // Attempt token creation
      console.log("\nAttempting token creation...");
      const tx = await launchpad.connect(user1).createAndInitPurchase(
        name,
        symbol,
        { value: launchFee }
      );

      console.log("Transaction hash:", tx.hash);
      const receipt = await tx.wait();
      console.log("Transaction status:", receipt?.status === 1 ? "Success" : "Failed");

      // Verify token creation
      const newTokenCount = await launchpad.tokenCount();
      console.log("New token count:", newTokenCount);

      if (newTokenCount > 0) {
        const tokenAddress = await launchpad.tokenAddress(newTokenCount - 1n);
        console.log("Created token address:", tokenAddress);

        // Get virtual pool info
        const pool = await launchpad.virtualPools(tokenAddress);
        console.log("\nVirtual pool state:");
        console.log("EDU Reserve:", ethers.formatEther(pool.EDUReserve));
        console.log("Token Reserve:", ethers.formatEther(pool.TokenReserve));
        console.log("Launched:", pool.launched);
      }
    });

    it("Should verify contract constants", async function() {
      const { launchpad } = await loadFixture(deployProxyFixture);

      console.log("\nContract Constants:");
      console.log("LAUNCH_THRESHOLD:", ethers.formatEther(await launchpad.LAUNCH_THRESHOLD()));
      console.log("LAUNCH_EDU_RESERVE:", ethers.formatEther(await launchpad.LAUNCH_EDU_RESERVE()));
      console.log("TOKEN_SUPPLY:", ethers.formatEther(await launchpad.TOKEN_SUPPLY()));
      console.log("VIRTUAL_TOKEN_RESERVE:", ethers.formatEther(await launchpad.VIRTUAL_TOKEN_RESERVE_AMOUNT()));
      console.log("VIRTUAL_EDU_RESERVE:", ethers.formatEther(await launchpad.VIRTUAL_EDU_RESERVE_AMOUNT()));
    });

    it("Should check all role permissions", async function() {
      const { launchpad, owner, user1 } = await loadFixture(deployProxyFixture);

      console.log("\nPermissions Check:");
      console.log("Owner:", owner.address);
      console.log("Operator:", await launchpad.operator());
      console.log("Launcher:", await launchpad.launcher());
    });
  });

  describe("Failure Cases", function() {
    it("Should handle token creation with exact parameters from error", async function() {
      const { launchpad, user1 } = await loadFixture(deployProxyFixture);

      try {
        const tx = await launchpad.connect(user1).createAndInitPurchase(
          "Quinn Ball",
          "ball",
          { value: ethers.parseEther("0.00000000000000001") }
        );
        await tx.wait();
        console.log("Transaction succeeded unexpectedly");
      } catch (error: any) {
        console.log("\nError details:");
        console.log("Error message:", error.message);
        if (error.data) {
          console.log("Error data:", error.data);
        }
        throw error;
      }
    });
  });

  describe("Token Creation Step by Step", function() {
    it("Should verify each step of token creation", async function() {
      const { launchpad, user1, launchFee } = await loadFixture(deployProxyFixture);

      // 1. Check if contract is paused
      const isPaused = await launchpad.paused();
      expect(isPaused).to.be.false;

      // 2. Verify launch fee
      const requiredFee = await launchpad.launchFee();
      expect(requiredFee).to.equal(launchFee);

      // 3. Check user's creator token count before
      const beforeCount = await launchpad.creatorTokenCount(user1.address);

      // 4. Get predicted address
      const predictedAddress = await launchpad.guessNewTokenAddress("Quinn Ball", "ball");

      // 5. Create token with events monitoring
      const tx = await launchpad.connect(user1).createAndInitPurchase(
        "Quinn Ball",
        "ball",
        { value: launchFee }
      );

      const receipt = await tx.wait();

      // 6. Check events
      const createEvent = receipt?.logs.find(
        (log: any) => log.fragment?.name === "TokenCreate"
      );

      if (createEvent) {
        console.log("\nToken Create Event:", {
          tokenAddress: createEvent.args[0],
          tokenIndex: createEvent.args[1],
          creator: createEvent.args[2]
        });
      }

      // 7. Verify final state
      const afterCount = await launchpad.creatorTokenCount(user1.address);
      expect(afterCount).to.equal(beforeCount + 1n);
    });
  });

  describe("Contract Setup", function() {
    it("Should verify proxy setup", async function() {
      const { launchpad, owner, implementation } = await loadFixture(deployProxyFixture);

      console.log("\nVerifying contract setup:");
      console.log("Owner:", await launchpad.owner());
      console.log("Vault:", await launchpad.vault());
      console.log("Launch fee:", ethers.formatEther(await launchpad.launchFee()));
      console.log("Implementation matches:",
        await upgrades.erc1967.getImplementationAddress(await launchpad.getAddress()) ===
        await implementation.getAddress()
      );
    });
  });

  describe("Contract Setup", function() {
    it("Should investigate implementation mismatch", async function() {
      const { launchpad, owner, implementation } = await loadFixture(deployProxyFixture);

      const proxyAddress = await launchpad.getAddress();
      const actualImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
      const expectedImplementation = await implementation.getAddress();

      console.log("\nImplementation Analysis:");
      console.log("Proxy Address:", proxyAddress);
      console.log("Expected Implementation:", expectedImplementation);
      console.log("Actual Implementation:", actualImplementation);

      // Let's get the implementation bytecode
      const actualBytecode = await ethers.provider.getCode(actualImplementation);
      const expectedBytecode = await ethers.provider.getCode(expectedImplementation);

      console.log("\nBytecode Analysis:");
      console.log("Bytecodes match:", actualBytecode === expectedBytecode);
      console.log("Actual bytecode length:", actualBytecode.length);
      console.log("Expected bytecode length:", expectedBytecode.length);

      // Let's try to call some functions on both implementations
      const LaunchpadFactory = await ethers.getContractFactory("LaunchpadContractV2");
      const actualImpl = LaunchpadFactory.attach(actualImplementation);
      const expectedImpl = LaunchpadFactory.attach(expectedImplementation);

      console.log("\nFunction Selectors:");
      console.log("createAndInitPurchase selector (actual):",
        (await actualImpl.getFunction("createAndInitPurchase")).selector);
      console.log("createAndInitPurchase selector (expected):",
        (await expectedImpl.getFunction("createAndInitPurchase")).selector);
    });

    it("Should verify exact implementation deployment", async function() {
      const LaunchpadFactory = await ethers.getContractFactory("LaunchpadContractV2");

      // Deploy implementation with explicit constructor parameters if any
      const implementation = await LaunchpadFactory.deploy();
      await implementation.waitForDeployment();

      // Deploy proxy using same factory
      const proxy = await upgrades.deployProxy(
        LaunchpadFactory,
        [
          ethers.ZeroAddress, // Test with zero address for vault
          0,                  // Test with zero launch fee
          0,                  // Test with zero sale fee
          0                   // Test with zero purchase fee
        ],
        {
          initializer: 'initialize',
          kind: 'uups',
          unsafeAllow: ['constructor']
        }
      );

      await proxy.waitForDeployment();

      const actualImpl = await upgrades.erc1967.getImplementationAddress(await proxy.getAddress());
      console.log("\nDirect Deployment Test:");
      console.log("Direct Implementation:", await implementation.getAddress());
      console.log("Proxy Implementation:", actualImpl);
    });

    it("Should check implementation initialization", async function() {
      const { launchpad } = await loadFixture(deployProxyFixture);

      const implAddress = await upgrades.erc1967.getImplementationAddress(await launchpad.getAddress());

      console.log("\nImplementation State:");
      try {
        // Try to call some view functions on the implementation
        const LaunchpadFactory = await ethers.getContractFactory("LaunchpadContractV2");
        const impl = LaunchpadFactory.attach(implAddress);

        console.log("Implementation owner:", await impl.owner());
        console.log("Implementation vault:", await impl.vault());
        console.log("Implementation launch fee:", ethers.formatEther(await impl.launchFee()));
      } catch (e) {
        console.log("Error reading implementation state:", e);
      }
    });
  });
});
