// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @notice Minimal interface for ERC20 tokens.
 */
interface IERC20 {
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

/**
 * @notice A simple Ownable contract.
 */
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

    /**
     * @notice Transfer the ownership to a new address.
     * @param newOwner The address to which ownership is transferred.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}

/**
 * @title DepositContract
 * @notice A secure deposit/withdraw contract for ETH and ERC20 tokens with signature verification
 */
contract DepositContract is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;

    // ------------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------------

    // Mapping: user => ETH balance
    mapping(address => uint256) public ethDeposits;

    // Mapping: user => (token => token balance)
    mapping(address => mapping(address => uint256)) public tokenDeposits;

    // Banlist mapping (user => bool)
    mapping(address => bool) public banned;

    // Server signer authorized to sign deposit/withdraw approvals
    address public serverSigner;

    // Nonce usage for replay protection: user => (nonce => used?)
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    // Add sequential nonce tracking
    mapping(address => uint256) public lastNonce;

    // ------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------

    event ETHDeposit(address indexed user, uint256 amount);
    event TokenDeposit(address indexed user, address indexed token, uint256 amount);

    event ETHWithdrawal(address indexed user, uint256 amount);
    event TokenWithdrawal(address indexed user, address indexed token, uint256 amount);

    event AddressBanned(address indexed user);
    event AddressUnbanned(address indexed user);

    event ServerSignerChanged(address indexed oldSigner, address indexed newSigner);

    event BalanceChange(
        address indexed user,
        string operation,  // "deposit" or "withdraw"
        bytes32 gameResultsHash  // Hash of all games since last balance change
    );

    // Add events for nonce usage and balance updates
    event NonceUsed(address indexed user, uint256 nonce);
    event BalanceUpdated(address indexed user, address indexed token, uint256 newBalance);
    event EmergencyPaused(address indexed by);
    event EmergencyUnpaused(address indexed by);

    // ------------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------------

    /**
     * @notice Modifier to ensure that the caller is not banned.
     */
    modifier notBanned() {
        require(!banned[msg.sender], "DepositContract: caller is banned");
        _;
    }

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    constructor() {
        // By default, let the contract owner also be the initial server signer
        serverSigner = msg.sender;
    }

    // ------------------------------------------------------------------------
    // Admin Functions
    // ------------------------------------------------------------------------

    /**
     * @notice Ban an address from interacting with the contract.
     * @param user The address to ban.
     */
    function banAddress(address user) external onlyOwner {
        banned[user] = true;
        emit AddressBanned(user);
    }

    /**
     * @notice Unban an address.
     * @param user The address to unban.
     */
    function unbanAddress(address user) external onlyOwner {
        banned[user] = false;
        emit AddressUnbanned(user);
    }

    /**
     * @notice Update the server signer address that authorizes deposits/withdrawals.
     * @param newSigner The new signer address.
     */
    function setServerSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Invalid signer address");
        emit ServerSignerChanged(serverSigner, newSigner);
        serverSigner = newSigner;
    }

    // ------------------------------------------------------------------------
    // Deposit Functions (Require Signature)
    // ------------------------------------------------------------------------

    struct ServerDepositAuth {
        uint256 expectedAmount;    // Amount server expects to be deposited
        uint256 nonce;            // Nonce for replay protection
    }

    /**
     * @notice Deposit ETH into the contract, requiring a server-signed authorization.
     * @param auth The struct containing the authorization data.
     * @param signature A signature from `serverSigner`.
     */
    function depositETH(
        ServerDepositAuth calldata auth,
        bytes calldata signature
    ) external payable notBanned whenNotPaused {
        require(auth.expectedAmount > 0, "Amount must be positive");
        require(msg.value == auth.expectedAmount, "ETH amount mismatch");
        _useNonce(msg.sender, auth.nonce);

        bytes32 messageHash = keccak256(
            abi.encode(
                "depositETH",
                block.chainid,
                msg.sender,
                auth.expectedAmount,
                auth.nonce,
                address(this)
            )
        );

        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(messageHash),
            signature
        );
        require(recovered == serverSigner, "DepositContract: invalid signature");

        ethDeposits[msg.sender] += auth.expectedAmount;
        emit ETHDeposit(msg.sender, auth.expectedAmount);
    }

    /**
     * @notice Deposit ERC20 tokens into the contract, requiring server-signed authorization.
     * @param auth The struct containing the authorization data.
     * @param token The ERC20 token address.
     * @param signature A signature from `serverSigner`.
     *
     * User must have first called `approve(thisContract, amount)` on the token contract.
     */
    function depositToken(
        ServerDepositAuth calldata auth,
        address token,
        bytes calldata signature
    ) external notBanned whenNotPaused {
        require(token != address(0), "Invalid token address");
        require(auth.expectedAmount > 0, "Amount must be positive");
        _useNonce(msg.sender, auth.nonce);

        bytes32 messageHash = keccak256(
            abi.encode(
                "depositToken",
                block.chainid,
                msg.sender,
                token,
                auth.expectedAmount,
                auth.nonce,
                address(this)
            )
        );

        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(messageHash),
            signature
        );
        require(recovered == serverSigner, "Invalid signature");

        // Track actual token balance changes
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        bool success = IERC20(token).transferFrom(msg.sender, address(this), auth.expectedAmount);
        require(success, "Token transfer failed");
        uint256 actualDeposit = IERC20(token).balanceOf(address(this)) - balanceBefore;
        
        tokenDeposits[msg.sender][token] += actualDeposit;
        
        emit TokenDeposit(msg.sender, token, actualDeposit);
        emit BalanceUpdated(msg.sender, token, tokenDeposits[msg.sender][token]);
    }

    // ------------------------------------------------------------------------
    // Withdrawal Functions (Require Signature)
    // ------------------------------------------------------------------------

    // Add a struct to pack the server authorization data
    struct ServerAuthorization {
        uint256 amount;          // Amount to withdraw
        uint256 currentBalance;  // Current balance before withdrawal
        uint256 newBalance;      // New balance after withdrawal
        bytes32 gameResultsHash; // Hash of all games since last balance change
        uint256 nonce;          // Nonce for replay protection
    }

    /**
     * @notice Withdraw ETH from the contract, requiring server-signed authorization.
     * @param auth The struct containing the authorization data.
     * @param signature A signature from `serverSigner`.
     */
    function withdrawETH(
        ServerAuthorization calldata auth,
        bytes calldata signature
    ) external notBanned nonReentrant whenNotPaused {
        require(ethDeposits[msg.sender] == auth.currentBalance, "DepositContract: balance changed");
        require(auth.currentBalance >= auth.amount, "DepositContract: insufficient balance");
        require(auth.currentBalance - auth.amount == auth.newBalance, "DepositContract: invalid balance math");
        _useNonce(msg.sender, auth.nonce);

        bytes32 messageHash = keccak256(
            abi.encode(
                "withdrawETH",
                block.chainid,
                msg.sender,
                auth,
                address(this)
            )
        );

        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(messageHash),
            signature
        );
        require(recovered == serverSigner, "DepositContract: invalid signature");

        // Emit events before external calls
        emit ETHWithdrawal(msg.sender, auth.amount);
        emit BalanceChange(msg.sender, "withdraw", auth.gameResultsHash);

        // Set balance directly to server-authorized new balance
        ethDeposits[msg.sender] = auth.newBalance;

        // External call last
        (bool sent, ) = payable(msg.sender).call{value: auth.amount}("");
        require(sent, "DepositContract: ETH transfer failed");
    }

    /**
     * @notice Withdraw ERC20 tokens from the contract, requiring server-signed authorization.
     * @param auth The struct containing the authorization data.
     * @param token The ERC20 token address.
     * @param signature A signature from `serverSigner`.
     */
    function withdrawToken(
        ServerAuthorization calldata auth,
        address token,
        bytes calldata signature
    ) external notBanned nonReentrant whenNotPaused {
        require(tokenDeposits[msg.sender][token] == auth.currentBalance, "DepositContract: balance changed");
        require(auth.currentBalance >= auth.amount, "DepositContract: insufficient balance");
        require(auth.currentBalance - auth.amount == auth.newBalance, "DepositContract: invalid balance math");
        _useNonce(msg.sender, auth.nonce);

        require(token != address(0), "Invalid token address");
        bytes32 messageHash = keccak256(
            abi.encode(
                "withdrawToken",
                block.chainid,
                msg.sender,
                token,
                auth,
                address(this)
            )
        );

        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(messageHash),
            signature
        );
        require(recovered == serverSigner, "DepositContract: invalid signature");

        // Emit events before external calls
        emit TokenWithdrawal(msg.sender, token, auth.amount);
        emit BalanceChange(msg.sender, "withdraw", auth.gameResultsHash);

        // Set balance directly to server-authorized new balance
        tokenDeposits[msg.sender][token] = auth.newBalance;

        // External call last
        bool success = IERC20(token).transfer(msg.sender, auth.amount);
        require(success, "DepositContract: token transfer failed");
    }

    // ------------------------------------------------------------------------
    // Internal Helpers
    // ------------------------------------------------------------------------

    /**
     * @dev Marks a nonce as used for the given user. Reverts if already used.
     */
    function _useNonce(address user, uint256 nonce) internal {
        require(nonce > lastNonce[user], "Nonce must be sequential");
        lastNonce[user] = nonce;
        emit NonceUsed(user, nonce);
    }

    // Add emergency pause functionality
    function pause() external onlyOwner {
        _pause();
        emit EmergencyPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }

    // Add explicit receive function
    receive() external payable {
        revert("Direct ETH deposits not allowed");
    }

    // Add contract balance check
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // Add token balance check
    function getContractTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // Add emergency withdrawal for owner
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool sent,) = payable(owner).call{value: amount}("");
            require(sent, "ETH transfer failed");
        } else {
            require(IERC20(token).transfer(owner, amount), "Token transfer failed");
        }
    }
}
