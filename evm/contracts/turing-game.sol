// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal interface for ERC20 tokens.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice A simple Ownable contract.
contract Ownable {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    /// @notice Transfer the ownership to a new address.
    /// @param newOwner The address to which ownership is transferred.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}

/// @notice A deposit/withdraw contract for ETH and ERC20 tokens, with banlist functionality.
contract DepositContract is Ownable {
    // Mapping from user => ETH balance
    mapping(address => uint256) public ethDeposits;

    // Mapping from user => (token address => token balance)
    mapping(address => mapping(address => uint256)) public tokenDeposits;

    // Banlist mapping (user => bool)
    mapping(address => bool) public banned;

    // --- Events ---
    event ETHDeposit(address indexed user, uint256 amount);
    event TokenDeposit(address indexed user, address indexed token, uint256 amount);
    event ETHWithdrawal(address indexed user, uint256 amount);
    event TokenWithdrawal(address indexed user, address indexed token, uint256 amount);

    event BatchTokenUpdate(address indexed token, address[] users, uint256[] newBalances);
    event BatchETHUpdate(address[] users, uint256[] newBalances);

    event AddressBanned(address indexed user);
    event AddressUnbanned(address indexed user);

    /// @notice Modifier to ensure that the caller is not banned.
    modifier notBanned() {
        require(!banned[msg.sender], "DepositContract: caller is banned");
        _;
    }

    // ------------------------------------------------------------------------
    // Banlist Management (Only Owner)
    // ------------------------------------------------------------------------

    /// @notice Ban an address from interacting with the contract.
    /// @param user The address to ban.
    function banAddress(address user) external onlyOwner {
        banned[user] = true;
        emit AddressBanned(user);
    }

    /// @notice Unban an address.
    /// @param user The address to unban.
    function unbanAddress(address user) external onlyOwner {
        banned[user] = false;
        emit AddressUnbanned(user);
    }

    // ------------------------------------------------------------------------
    // Deposit Functions
    // ------------------------------------------------------------------------

    /// @notice Deposit ETH into the contract.
    /// Must send ETH along with the transaction.
    function depositETH() external payable notBanned {
        require(msg.value > 0, "Deposit must be greater than zero");
        ethDeposits[msg.sender] += msg.value;
        emit ETHDeposit(msg.sender, msg.value);
    }

    /// @notice Deposit ERC20 tokens into the contract.
    /// User must have called `approve(thisContract, amount)` beforehand on the token contract.
    /// @param token The ERC20 token address.
    /// @param amount The amount of tokens to deposit.
    function depositToken(address token, uint256 amount) external notBanned {
        require(amount > 0, "Amount must be greater than zero");
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");
        tokenDeposits[msg.sender][token] += amount;
        emit TokenDeposit(msg.sender, token, amount);
    }

    // ------------------------------------------------------------------------
    // Withdrawal Functions
    // ------------------------------------------------------------------------

    /// @notice Withdraw ETH from your deposit.
    /// @param amount The amount of ETH to withdraw in wei.
    function withdrawETH(uint256 amount) external notBanned {
        require(ethDeposits[msg.sender] >= amount, "Insufficient ETH balance");
        ethDeposits[msg.sender] -= amount;

        // Transfer the ETH to the user.
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "ETH transfer failed");

        emit ETHWithdrawal(msg.sender, amount);
    }

    /// @notice Withdraw ERC20 tokens from your deposit.
    /// @param token The ERC20 token address.
    /// @param amount The amount of tokens to withdraw.
    function withdrawToken(address token, uint256 amount) external notBanned {
        require(tokenDeposits[msg.sender][token] >= amount, "Insufficient token balance");
        tokenDeposits[msg.sender][token] -= amount;

        bool success = IERC20(token).transfer(msg.sender, amount);
        require(success, "Token transfer failed");

        emit TokenWithdrawal(msg.sender, token, amount);
    }

    // ------------------------------------------------------------------------
    // Batch Update Functions (Only Owner)
    // ------------------------------------------------------------------------

    /// @notice Batch update token balances for multiple users.
    /// This force-sets a new deposit balance for each user.
    /// @param token The ERC20 token address.
    /// @param users The array of user addresses to update.
    /// @param newBalances The array of new deposit balances corresponding to each user.
    function batchUpdateTokenBalances(
        address token,
        address[] calldata users,
        uint256[] calldata newBalances
    ) external onlyOwner {
        require(users.length == newBalances.length, "Array length mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            tokenDeposits[users[i]][token] = newBalances[i];
        }
        emit BatchTokenUpdate(token, users, newBalances);
    }

    /// @notice Batch update ETH balances for multiple users.
    /// This force-sets a new deposit balance for each user.
    /// @param users The array of user addresses to update.
    /// @param newBalances The array of new deposit balances for each user.
    function batchUpdateETHBalances(
        address[] calldata users,
        uint256[] calldata newBalances
    ) external onlyOwner {
        require(users.length == newBalances.length, "Array length mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            ethDeposits[users[i]] = newBalances[i];
        }
        emit BatchETHUpdate(users, newBalances);
    }
}
