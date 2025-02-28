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
 * @title TuringTournament
 * @notice This contract now:
 *  - Accepts ETH and token deposits/withdrawals.
 *  - Tracks tournament performance using wins and games played.
 *  - At tournament finalization, the entire contract balance (ETH and all recorded ERC20 tokens)
 *    is transferred to the winner, determined by the highest ranking computed as:
 *         (wins^2 * 1e18) / gamesPlayed.
 *  - The ranking is equivalent to number of wins multiplied by winrate. A quadratic.
 */
contract TuringTournament is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;

    // ------------------------------------------------------------------------
    // Storage for Deposits and Basic Mappings
    // ------------------------------------------------------------------------

    // Mapping: user => ETH balance
    mapping(address => uint256) public ethDeposits;

    // Mapping: user => (token => token balance)
    mapping(address => mapping(address => uint256)) public tokenDeposits;

    // Banlist mapping (user => bool)
    mapping(address => bool) public banned;

    // Authorized server signer for off-chain approvals.
    address public serverSigner;

    // Nonce usage for replay protection: user => (nonce => used?)
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    // Add sequential nonce tracking
    mapping(address => uint256) public lastNonce;

    // ------------------------------------------------------------------------
    // Tournament-Related Storage
    // ------------------------------------------------------------------------
    // Tournament performance tracking.
    mapping(address => uint256) public wins;
    mapping(address => uint256) public gamesPlayed;

    // List of tournament participants.
    address[] public participants;
    // Helper mapping to avoid duplicate entries.
    mapping(address => bool) public isParticipant;

    // Tournament status and timing.
    bool public tournamentActive;
    uint256 public tournamentStartTime;
    uint256 public tournamentEndTime;

    // Array to record ERC20 tokens deposited (forming part of the prize pool).
    address[] public tournamentTokens;
    mapping(address => bool) public tokenRecorded;

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

    // Game result event logs the score change.
    event GameResultUpdated(
        address indexed user,
        address indexed token,
        bytes32 indexed gameId,
        int256 scoreChange,
        bytes32 gameResultHash
    );

    // Tournament-specific events.
    event TournamentStarted(uint256 startTime);
    event TournamentEnded(uint256 endTime, address winner);
    event RewardDistributed(address winner);

    // GameResult includes the game ID, final balance, a hash for verification, and the score change.
    struct GameResult {
        bytes32 gameId;           // Unique identifier for the game.
        uint256 newBalance;       // Final balance after the game.
        bytes32 gameResultHash;   // Hash of game data for verification.
        int256 scoreChange;       // Change in score (positive for win).
    }

    // Struct for server-signed authorization for withdrawals.
    struct ServerAuthorization {
        uint256 amount;          // Amount to withdraw.
        uint256 currentBalance;  // Current balance before withdrawal.
        uint256 newBalance;      // New balance after withdrawal.
        bytes32 gameResultsHash; // Hash of game data (if applicable).
        uint256 nonce;           // Nonce for replay protection.
    }

    // ------------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------------

    /**
     * @notice Modifier to ensure that the caller is not banned.
     */
    modifier notBanned() {
        require(!banned[msg.sender], "caller is banned");
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
    // Deposit Functions
    // ------------------------------------------------------------------------

    function depositETH() external payable notBanned whenNotPaused {
        require(msg.value > 0, "Amount must be positive");

        ethDeposits[msg.sender] += msg.value;
        emit ETHDeposit(msg.sender, msg.value);
        emit BalanceUpdated(msg.sender, address(0), ethDeposits[msg.sender]);
    }

    function depositToken(
        address token,
        uint256 amount
    ) external notBanned whenNotPaused {
        require(token != address(0), "Invalid token address");
        require(amount > 0, "Amount must be positive");

        // Track actual token balance changes
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");
        uint256 actualDeposit = IERC20(token).balanceOf(address(this)) - balanceBefore;

        tokenDeposits[msg.sender][token] += actualDeposit;

        emit TokenDeposit(msg.sender, token, actualDeposit);
        emit BalanceUpdated(msg.sender, token, tokenDeposits[msg.sender][token]);

        // Record token for tournament prize pool if not already recorded.
        if (!tokenRecorded[token]) {
            tokenRecorded[token] = true;
            tournamentTokens.push(token);
        }
    }

    // ------------------------------------------------------------------------
    // Withdrawal Functions (Require Signature)
    // ------------------------------------------------------------------------
    function withdrawETH(
        ServerAuthorization calldata auth,
        bytes calldata signature
    ) external notBanned nonReentrant whenNotPaused {
        require(ethDeposits[msg.sender] == auth.currentBalance, "Balance changed");
        require(auth.currentBalance >= auth.amount, "Insufficient balance");
        require(auth.currentBalance - auth.amount == auth.newBalance, "Invalid balance math");
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
        require(recovered == serverSigner, "Invalid signature");

        // Emit events before external calls
        emit ETHWithdrawal(msg.sender, auth.amount);
        emit BalanceChange(msg.sender, "withdraw", auth.gameResultsHash);
        emit BalanceUpdated(msg.sender, address(0), auth.newBalance);

        // Set balance directly to server-authorized new balance
        ethDeposits[msg.sender] = auth.newBalance;

        // External call last
        (bool sent, ) = payable(msg.sender).call{value: auth.amount}("");
        require(sent, "ETH transfer failed");
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
        require(tokenDeposits[msg.sender][token] == auth.currentBalance, "Balance changed");
        require(auth.currentBalance >= auth.amount, "Insufficient balance");
        require(auth.currentBalance - auth.amount == auth.newBalance, "Invalid balance math");
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
        require(recovered == serverSigner, "Invalid signature");

        // Emit events before external calls
        emit TokenWithdrawal(msg.sender, token, auth.amount);
        emit BalanceChange(msg.sender, "withdraw", auth.gameResultsHash);

        // Set balance directly to server-authorized new balance
        tokenDeposits[msg.sender][token] = auth.newBalance;

        // External call last
        bool success = IERC20(token).transfer(msg.sender, auth.amount);
        require(success, "Token transfer failed");
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

    // ------------------------------------------------------------------------
    // Emergency Functions
    // ------------------------------------------------------------------------
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
            (bool sent, ) = payable(owner).call{value: amount}("");
            require(sent, "ETH transfer failed");
        } else {
            require(IERC20(token).transfer(owner, amount), "Token transfer failed");
        }
    }

    // ------------------------------------------------------------------------
    // Tournament and Game Result Functions
    // ------------------------------------------------------------------------

    /**
     * @notice Update balance and tournament performance based on a game result.
     * @dev The off-chain server must sign the message containing gameId, newBalance, gameResultHash,
     *      scoreChange, nonce, etc.
     *      A positive scoreChange indicates a win.
     */
    function updateGameResult(
        address token,
        GameResult calldata game,
        uint256 nonce,
        bytes calldata signature
    ) external notBanned nonReentrant whenNotPaused {
        uint256 currentBalance = token == address(0)
            ? ethDeposits[msg.sender]
            : tokenDeposits[msg.sender][token];
        // Verify the expected new balance: currentBalance + scoreChange == newBalance.
        int256 expectedNewBalance = int256(currentBalance) + game.scoreChange;
        require(expectedNewBalance == int256(game.newBalance), "Invalid balance math");

        _useNonce(msg.sender, nonce);

        // Verify server signature
        bytes32 messageHash = keccak256(
            abi.encode(
                "updateGame",
                block.chainid,
                msg.sender,
                token,
                game.gameId,
                game.newBalance,
                game.gameResultHash,
                game.scoreChange,
                nonce,
                address(this)
            )
        );

        address recovered = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(messageHash),
            signature
        );
        require(recovered == serverSigner, "Invalid signature");

        // Update balance
        if (token == address(0)) {
            ethDeposits[msg.sender] = game.newBalance;
            emit BalanceUpdated(msg.sender, address(0), game.newBalance);
        } else {
            tokenDeposits[msg.sender][token] = game.newBalance;
            emit BalanceUpdated(msg.sender, token, game.newBalance);
        }

        // If a tournament is active, update performance metrics.
        if (tournamentActive) {
            gamesPlayed[msg.sender] += 1;
            if (game.scoreChange > 0) {
                wins[msg.sender] += 1;
            }
            if (!isParticipant[msg.sender]) {
                isParticipant[msg.sender] = true;
                participants.push(msg.sender);
            }
        }

        // Emit game result with calculated amount change
        emit GameResultUpdated(
            msg.sender,
            token,
            game.gameId,
            game.scoreChange,
            game.gameResultHash
        );
    }

    /**
     * @notice Starts a new tournament.
     * @dev Only the owner can start a tournament. This resets prior tournament performance.
     */
    function startTournament(uint256 duration) external onlyOwner {
        require(!tournamentActive, "Tournament already active");
        tournamentActive = true;
        tournamentStartTime = block.timestamp;
        tournamentEndTime = block.timestamp + duration;

        // Reset tournament state.
        for (uint256 i = 0; i < participants.length; i++) {
            address participant = participants[i];
            wins[participant] = 0;
            gamesPlayed[participant] = 0;
            isParticipant[participant] = false;
        }
        delete participants;

        emit TournamentStarted(tournamentStartTime);
    }

    /**
     * @notice Finalizes the tournament and distributes the total contract balance (ETH and all ERC20 tokens)
     *         to the winner. The winner is determined by the highest ranking, calculated as:
     *         (wins^2 * 1e18) / gamesPlayed. This is equivalent to number of wins multiplied by winrate.
     *         The tournament is over when the end time is reached. This can be called permissionlessly.
     */
    function finalizeTournament() external nonReentrant {
        require(tournamentActive, "Tournament not active");
        require(block.timestamp >= tournamentEndTime, "Tournament not ended yet");
        require(participants.length > 0, "No participants in tournament");

        address winner = participants[0];
        uint256 bestRanking = getRanking(winner);
        for (uint256 i = 1; i < participants.length; i++) {
            uint256 ranking = getRanking(participants[i]);
            if (ranking > bestRanking) {
                bestRanking = ranking;
                winner = participants[i];
            }
        }

        tournamentActive = false;

        // Transfer all ETH in the contract to the winner.
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = payable(winner).call{value: ethBalance}("");
            require(sent, "ETH transfer failed");
        }

        // Transfer all ERC20 tokens recorded to the winner.
        for (uint256 i = 0; i < tournamentTokens.length; i++) {
            address token = tournamentTokens[i];
            uint256 tokenBal = IERC20(token).balanceOf(address(this));
            if (tokenBal > 0) {
                bool success = IERC20(token).transfer(winner, tokenBal);
                require(success, "Token transfer failed");
            }
        }

        emit TournamentEnded(block.timestamp, winner);
        emit RewardDistributed(winner);
    }

    // Internal helper to compute ranking for a participant.
    // Ranking = (wins^2 * 1e18) / gamesPlayed. 
    // This is equivalent to number of wins multiplied by winrate.
    function getRanking(address participant) internal view returns (uint256) {
        if (gamesPlayed[participant] == 0) return 0;
        return (wins[participant] * wins[participant] * 1e18) / gamesPlayed[participant];
    }

}
