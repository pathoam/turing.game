// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

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
 * @notice A deposit/withdraw contract for ETH and ERC20 tokens with banlist and
 *         signature-based authorization for deposits/withdrawals.
 */
contract DepositContract is Ownable {
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

    /**
     * @notice Deposit ETH into the contract, requiring a server-signed authorization.
     * @param amount The intended deposit amount (must match `msg.value`).
     * @param nonce A unique nonce for this deposit (used for replay protection).
     * @param gameResultsHash Hash of all games since last balance change.
     * @param signature A signature from `serverSigner`.
     */
    function depositETH(
        uint256 amount,
        uint256 nonce,
        bytes32 gameResultsHash,
        bytes calldata signature
    ) external payable notBanned {
        require(msg.value == amount, "DepositContract: ETH amount mismatch");
        _useNonce(msg.sender, nonce);

        // Construct the message hash that the server signs off-chain:
        //   "depositETH", user, amount, gameResultsHash, nonce, thisContractAddress
        // The literal strings should match exactly what your backend signs.
        bytes32 messageHash = keccak256(
            abi.encodePacked("depositETH", msg.sender, amount, gameResultsHash, nonce, address(this))
        );

        // Recover the signer of the hashed message (with the standard Ethereum Signed Message prefix)
        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(messageHash),
            signature
        );
        require(recovered == serverSigner, "DepositContract: invalid signature from server");

        // Update user's on-chain ETH balance
        ethDeposits[msg.sender] += amount;
        emit ETHDeposit(msg.sender, amount);
        emit BalanceChange(msg.sender, "deposit", gameResultsHash);
    }

    /**
     * @notice Deposit ERC20 tokens into the contract, requiring server-signed authorization.
     * @param token The ERC20 token address.
     * @param amount The amount of tokens to deposit.
     * @param nonce A unique nonce for this deposit (used for replay protection).
     * @param signature A signature from `serverSigner`.
     *
     * User must have first called `approve(thisContract, amount)` on the token contract.
     */
    function depositToken(
        address token,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external notBanned {
        require(amount > 0, "DepositContract: amount must be > 0");
        _useNonce(msg.sender, nonce);

        // Construct the message hash
        bytes32 messageHash = keccak256(
            abi.encodePacked("depositToken", msg.sender, token, amount, nonce, address(this))
        );
        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(messageHash),
            signature
        );
        require(recovered == serverSigner, "DepositContract: invalid signature from server");

        // Transfer tokens in
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "DepositContract: token transferFrom failed");

        // Update user's on-chain token balance
        tokenDeposits[msg.sender][token] += amount;
        emit TokenDeposit(msg.sender, token, amount);
    }

    // ------------------------------------------------------------------------
    // Withdrawal Functions (Require Signature)
    // ------------------------------------------------------------------------

    /**
     * @notice Withdraw ETH from the contract, requiring server-signed authorization.
     * @param amount The amount of ETH to withdraw.
     * @param nonce A unique nonce for this withdrawal (replay protection).
     * @param gameResultsHash Hash of all games since last balance change.
     * @param signature A signature from `serverSigner`.
     */
    function withdrawETH(
        uint256 amount,
        uint256 nonce,
        bytes32 gameResultsHash,
        bytes calldata signature
    ) external notBanned {
        require(ethDeposits[msg.sender] >= amount, "DepositContract: insufficient ETH balance");
        _useNonce(msg.sender, nonce);

        // Include gameResultsHash in message
        bytes32 messageHash = keccak256(
            abi.encodePacked("withdrawETH", msg.sender, amount, gameResultsHash, nonce, address(this))
        );
        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(messageHash),
            signature
        );
        require(recovered == serverSigner, "DepositContract: invalid signature from server");

        ethDeposits[msg.sender] -= amount;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "DepositContract: ETH transfer failed");
        emit ETHWithdrawal(msg.sender, amount);
        emit BalanceChange(msg.sender, "withdraw", gameResultsHash);
    }

    /**
     * @notice Withdraw ERC20 tokens from the contract, requiring server-signed authorization.
     * @param token The ERC20 token address.
     * @param amount The amount of tokens to withdraw.
     * @param nonce A unique nonce for this withdrawal (replay protection).
     * @param gameResultsHash Hash of all games since last balance change.
     * @param signature A signature from `serverSigner`.
     */
    function withdrawToken(
        address token,
        uint256 amount,
        uint256 nonce,
        bytes32 gameResultsHash,
        bytes calldata signature
    ) external notBanned {
        require(tokenDeposits[msg.sender][token] >= amount, "DepositContract: insufficient token balance");
        _useNonce(msg.sender, nonce);

        bytes32 messageHash = keccak256(
            abi.encodePacked("withdrawToken", msg.sender, token, amount, gameResultsHash, nonce, address(this))
        );
        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(messageHash),
            signature
        );
        require(recovered == serverSigner, "DepositContract: invalid signature from server");

        tokenDeposits[msg.sender][token] -= amount;
        bool success = IERC20(token).transfer(msg.sender, amount);
        require(success, "DepositContract: token transfer failed");
        emit TokenWithdrawal(msg.sender, token, amount);
        emit BalanceChange(msg.sender, "withdraw", gameResultsHash);
    }

    // ------------------------------------------------------------------------
    // Internal Helpers
    // ------------------------------------------------------------------------

    /**
     * @dev Marks a nonce as used for the given user. Reverts if already used.
     */
    function _useNonce(address user, uint256 nonce) internal {
        require(!usedNonces[user][nonce], "DepositContract: nonce already used");
        usedNonces[user][nonce] = true;
    }
}
