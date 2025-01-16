// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import {LaunchpadToken} from "./LaunchpadToken.sol";
import {IRouter} from "./IRouter.sol";

contract LaunchpadContractV2 is Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {
    // State variables
    uint256 public constant LAUNCH_THRESHOLD = 10000 ether;
    uint256 public constant LAUNCH_EDU_RESERVE = 5000 ether;
    uint256 public constant TOKEN_SUPPLY = 1000000 ether;
    uint256 public constant TOTAL_SALE = 900000 ether;
    uint256 public constant VIRTUAL_TOKEN_RESERVE_AMOUNT = 1000 ether;
    uint256 public constant VIRTUAL_EDU_RESERVE_AMOUNT = 1 ether;

    address public deadAddress;
    address public launcher;
    uint256 public launchFee;
    uint256 public maxPurchaseAmount;
    uint256 public minTxFee;
    uint256 public mintFee;
    address public operator;
    uint256 public purchaseFee;
    uint256 public saleFee;
    address public vault;

    uint256 public tokenCount;
    mapping(uint256 => address) public tokenAddress;
    mapping(address => address) public tokenCreator;
    mapping(address => VirtualPool) public virtualPools;

    // new variables
    mapping(address => address[]) public creatorTokens;

    struct VirtualPool {
        uint256 EDUReserve;
        uint256 TokenReserve;
        bool launched;
    }

    // Events
    event LaunchPending(address token);
    event LauncherChanged(address indexed oldLauncher, address indexed newLauncher);
    event LaunchFeeSet(uint256 oldFee, uint256 newFee);
    event MinTxFeeSet(uint256 oldFee, uint256 newFee);
    event MintFeeSet(uint256 oldFee, uint256 newFee);
    event OperatorChanged(address indexed oldOperator, address indexed newOperator);
    event PurchaseFeeSet(uint256 oldFee, uint256 newFee);
    event SaleFeeSet(uint256 oldFee, uint256 newFee);
    event TokenCreate(address tokenAddress, uint256 tokenIndex, address creator);
    event TokenLaunched(address indexed token);
    event TokenPurchased(address indexed token, address indexed buyer, uint256 trxAmount, uint256 fee, uint256 tokenAmount, uint256 tokenReserve);
    event TokenSold(address indexed token, address indexed seller, uint256 trxAmount, uint256 fee, uint256 tokenAmount);
    event MaxPurchaseAmountSet(uint256 oldAmount, uint256 newAmount);
    event VaultChanged(address indexed oldVault, address indexed newVault);
    event V2RouterChanged(address indexed oldRouter, address indexed newRouter);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function initialize(address _vault, uint256 _launchFee, uint256 _salefee, uint256 _purchasefee) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __Pausable_init();

        vault = _vault;
        launchFee = _launchFee;
        saleFee = _salefee;
        purchaseFee = _purchasefee;
        operator = msg.sender;
        launcher = msg.sender;
        deadAddress = address(0);
        maxPurchaseAmount = type(uint256).max; // Set to max by default
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // Administrative functions
    function setLauncher(address newLauncher) public onlyOwner {
        require(newLauncher != address(0), "Invalid launcher address");
        address oldLauncher = launcher;
        launcher = newLauncher;
        emit LauncherChanged(oldLauncher, newLauncher);
    }

    function setOperator(address newOperator) public onlyOwner {
        require(newOperator != address(0), "Invalid operator address");
        address oldOperator = operator;
        operator = newOperator;
        emit OperatorChanged(oldOperator, newOperator);
    }

    function setVault(address newVault) public onlyOwner {
        require(newVault != address(0), "Invalid vault address");
        address oldVault = vault;
        vault = newVault;
        emit VaultChanged(oldVault, newVault);
    }

    function setMinTxFee(uint256 newFee) public onlyOwner {
        uint256 oldFee = minTxFee;
        minTxFee = newFee;
        emit MinTxFeeSet(oldFee, newFee);
    }

    function setMintFee(uint256 newFee) public onlyOwner {
        uint256 oldFee = mintFee;
        mintFee = newFee;
        emit MintFeeSet(oldFee, newFee);
    }

    function setPurchaseFee(uint256 newFee) public onlyOwner {
        require(newFee <= 10000, "Fee must be <= 10000 (100%)");
        uint256 oldFee = purchaseFee;
        purchaseFee = newFee;
        emit PurchaseFeeSet(oldFee, newFee);
    }

    function setSaleFee(uint256 newFee) public onlyOwner {
        require(newFee <= 10000, "Fee must be <= 10000 (100%)");
        uint256 oldFee = saleFee;
        saleFee = newFee;
        emit SaleFeeSet(oldFee, newFee);
    }

    function setLaunchFee(uint256 newFee) public onlyOwner {
        uint256 oldFee = launchFee;
        launchFee = newFee;
        emit LaunchFeeSet(oldFee, newFee);
    }

    function setMaxPurchaseAmount(uint256 newAmount) public onlyOwner {
        uint256 oldAmount = maxPurchaseAmount;
        maxPurchaseAmount = newAmount;
        emit MaxPurchaseAmountSet(oldAmount, newAmount);
    }

    // Main functions
    function createAndInitPurchase(string memory name, string memory symbol) public payable whenNotPaused {
        emit DebugFunctionCall("createAndInitPurchase", msg.sender, msg.value);

        emit DebugStep("Before launch fee check", msg.value);
        require(msg.value >= launchFee, "Insufficient launch fee");
        emit DebugStep("After launch fee check", launchFee);

        // Create new ERC20 token
        bytes32 _salt = bytes32(creatorTokenCount(msg.sender));
        emit DebugStep("After salt creation", uint256(_salt));

        LaunchpadToken newToken = new LaunchpadToken{salt: _salt}(name, symbol);
        emit DebugStep("After token creation", 0);

        address _tokenAddress = address(newToken);

        // Initialize virtual pool
        virtualPools[_tokenAddress] = VirtualPool({
            EDUReserve: VIRTUAL_EDU_RESERVE_AMOUNT,
            TokenReserve: VIRTUAL_TOKEN_RESERVE_AMOUNT,
            launched: false
        });

        // Update state
        tokenAddress[tokenCount] = _tokenAddress;
        creatorTokens[msg.sender].push(_tokenAddress);
        tokenCount++;

        emit TokenCreate(_tokenAddress, tokenCount - 1, msg.sender);
        emit LaunchPending(_tokenAddress);
    }

    // Add a debug event
    event DebugFunctionCall(string functionName, address sender, uint256 value);
    event DebugStep(string step, uint256 value);

    function purchaseToken(address token, uint256 AmountMin) public payable whenNotPaused {
        emit DebugFunctionCall("purchaseToken", msg.sender, msg.value);
        require(msg.value > 0 && msg.value <= maxPurchaseAmount, "Invalid purchase amount");

        VirtualPool storage pool = virtualPools[token];
        require(pool.EDUReserve > 0, "Token not initialized");

        uint256 tokenAmount = getTokenAmountByPurchase(token, msg.value);
        require(tokenAmount >= AmountMin, "Slippage protection");

        (bool success, uint256 fee) = Math.tryMul(msg.value, purchaseFee);
        require(success, "Fee calculation overflow");
        (success, fee) = Math.tryDiv(fee, 10000);
        require(success, "Fee calculation overflow");

        uint256 trxAmount;
        (success, trxAmount) = Math.trySub(msg.value, fee);
        require(success, "EDU amount calculation underflow");

        (success, pool.EDUReserve) = Math.tryAdd(pool.EDUReserve, trxAmount);
        require(success, "EDU reserve update overflow");

        (success, pool.TokenReserve) = Math.trySub(pool.TokenReserve, tokenAmount);
        require(success, "Token reserve update underflow");

        require(IERC20(token).transfer(msg.sender, tokenAmount), "Token transfer failed");
        payable(vault).transfer(fee);

        emit TokenPurchased(token, msg.sender, trxAmount, fee, tokenAmount, pool.TokenReserve);
    }

    function saleToken(address token, uint256 tokenAmount, uint256 AmountMin) public whenNotPaused {
        require(tokenAmount > 0, "Invalid sale amount");

        VirtualPool storage pool = virtualPools[token];
        require(pool.EDUReserve > 0, "Token not initialized");

        uint256 trxAmount = getTrxAmountBySale(token, tokenAmount);
        require(trxAmount >= AmountMin, "Slippage protection");

        (bool success, uint256 fee) = Math.tryMul(trxAmount, saleFee);
        require(success, "Fee calculation overflow");
        (success, fee) = Math.tryDiv(fee, 10000);
        require(success, "Fee calculation overflow");

        uint256 trxAmountAfterFee;
        (success, trxAmountAfterFee) = Math.trySub(trxAmount, fee);
        require(success, "EDU amount calculation underflow");

        (success, pool.EDUReserve) = Math.trySub(pool.EDUReserve, trxAmount);
        require(success, "EDU reserve update underflow");

        (success, pool.TokenReserve) = Math.tryAdd(pool.TokenReserve, tokenAmount);
        require(success, "Token reserve update overflow");

        require(IERC20(token).transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");
        payable(msg.sender).transfer(trxAmountAfterFee);
        payable(vault).transfer(fee);

        emit TokenSold(token, msg.sender, trxAmount, fee, tokenAmount);
    }

    function launchToDEX(address token, address v2Router) public whenNotPaused {
        require(msg.sender == launcher, "Only launcher can launch tokens");
        VirtualPool storage pool = virtualPools[token];
        require(!pool.launched, "Token already launched");
        require(pool.EDUReserve >= LAUNCH_THRESHOLD, "Insufficient liquidity for launch");

        // Transfer tokens and EDU to DEX
        uint256 launchLiquidity = LAUNCH_EDU_RESERVE;
        uint256 tokenLiquidity = getTokenAmountByPurchase(token, launchLiquidity);

        require(IERC20(token).approve(v2Router, tokenLiquidity), "Token approval failed");

        // Add liquidity to DEX (implementation depends on the specific DEX)
        IRouter(v2Router).addLiquidity(token,
            address(0),
            false,
            tokenLiquidity,
            launchLiquidity,
            0,
            0,
            address(this),
            type(uint256).max);

        pool.launched = true;
        emit TokenLaunched(token);
    }

    // Helper functions
    function getTokenAmountByPurchase(address token, uint256 trxAmount) public view returns (uint256 tokenAmount) {
        VirtualPool storage pool = virtualPools[token];
        (bool success, uint256 result) = Math.tryMul(trxAmount, pool.TokenReserve);
        require(success, "Calculation overflow");
        (success, result) = Math.tryDiv(result, pool.EDUReserve);
        require(success, "Calculation overflow");
        return result;
    }

    function getTrxAmountBySale(address token, uint256 tokenAmount) public view returns (uint256 trxAmount) {
        VirtualPool storage pool = virtualPools[token];
        (bool success, uint256 result) = Math.tryMul(tokenAmount, pool.EDUReserve);
        require(success, "Calculation overflow");
        (success, result) = Math.tryDiv(result, pool.TokenReserve);
        require(success, "Calculation overflow");
        return result;
    }

    function getPrice(address token) public view returns (uint256) {
        VirtualPool storage pool = virtualPools[token];
        (bool success, uint256 result) = Math.tryMul(pool.EDUReserve, 1e18);
        require(success, "Calculation overflow");
        (success, result) = Math.tryDiv(result, pool.TokenReserve);
        require(success, "Calculation overflow");
        return result;
    }

    function guessNewTokenAddress(string memory name, string memory symbol) public view returns (address) {
        bytes memory creationCode = type(LaunchpadToken).creationCode;
        bytes memory _bytecode = abi.encodePacked(creationCode, abi.encode(name, symbol));

        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                creatorTokenCount(msg.sender),
                keccak256(_bytecode)
            )
        );

        return address(uint160(uint(hash)));
    }

    function creatorTokenCount(address _creator) public view returns (uint256) {
        return creatorTokens[_creator].length;
    }

    function tokensByCreator(address _creator) public view returns (address[] memory) {
        return creatorTokens[_creator];
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    receive() external payable {}
}
