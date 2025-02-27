const { ethers, network } = require("hardhat");

describe("DepositContract", function () {
  let DepositContract, depositContract;
  let owner, user, other, serverSigner;
  let chainId;
  let TestToken, token;

  // Helper: sign message for withdrawETH
  async function signWithdrawETH(auth, user, contract, chainId, signer) {
    const encodedAuth = ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256", "uint256", "bytes32", "uint256"],
      [auth.amount, auth.currentBalance, auth.newBalance, auth.gameResultsHash, auth.nonce]
    );
    const message = ethers.utils.defaultAbiCoder.encode(
      ["string", "uint256", "address", "bytes", "address"],
      ["withdrawETH", chainId, user.address, encodedAuth, contract.address]
    );
    const messageHash = ethers.utils.keccak256(message);
    return await signer.signMessage(ethers.utils.arrayify(messageHash));
  }

  // Helper: sign message for withdrawToken
  async function signWithdrawToken(auth, user, token, contract, chainId, signer) {
    const encodedAuth = ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256", "uint256", "bytes32", "uint256"],
      [auth.amount, auth.currentBalance, auth.newBalance, auth.gameResultsHash, auth.nonce]
    );
    const message = ethers.utils.defaultAbiCoder.encode(
      ["string", "uint256", "address", "address", "bytes", "address"],
      ["withdrawToken", chainId, user.address, token.address, encodedAuth, contract.address]
    );
    const messageHash = ethers.utils.keccak256(message);
    return await signer.signMessage(ethers.utils.arrayify(messageHash));
  }

  // Helper: sign message for updateGameResult
  async function signUpdateGameResult(game, nonce, user, token, contract, chainId, signer) {
    const message = ethers.utils.defaultAbiCoder.encode(
      [
        "string",
        "uint256",
        "address",
        "address",
        "bytes32",
        "uint256",
        "bytes32",
        "int256",
        "uint256",
        "uint256",
        "address",
      ],
      [
        "updateGame",
        chainId,
        user.address,
        token.address,
        game.gameId,
        game.newBalance,
        game.gameResultHash,
        game.scoreChange,
        game.fee,
        nonce,
        contract.address,
      ]
    );
    const messageHash = ethers.utils.keccak256(message);
    return await signer.signMessage(ethers.utils.arrayify(messageHash));
  }

  beforeEach(async function () {
    [owner, user, other, serverSigner] = await ethers.getSigners();
    // Deploy the DepositContract with owner as deployer (and thus initial serverSigner)
    const DepositContractFactory = await ethers.getContractFactory("DepositContract");
    const depositContract = await DepositContractFactory.deploy();

    // Get the current chainId
    const networkObj = await ethers.provider.getNetwork();
    chainId = networkObj.chainId;

    // Deploy a test ERC20 token.
    TestToken = await ethers.getContractFactory("TestToken");
    token = await TestToken.deploy("TestToken", "TTK", ethers.utils.parseEther("1000"));
    await token.deployed();

    // Give the user some tokens.
    await token.transfer(user.address, ethers.utils.parseEther("100"));
  });

  describe("ETH Deposits and Withdrawals", function () {
    it("should allow a user to deposit ETH", async function () {
      const depositAmount = ethers.utils.parseEther("1");
      await expect(
        depositContract.connect(user).depositETH({ value: depositAmount })
      )
        .to.emit(depositContract, "ETHDeposit")
        .withArgs(user.address, depositAmount);

      const balance = await depositContract.ethDeposits(user.address);
      expect(balance).to.equal(depositAmount);
    });

    it("should allow a user to withdraw ETH with a valid signature", async function () {
      // First, deposit some ETH.
      const depositAmount = ethers.utils.parseEther("2");
      await depositContract.connect(user).depositETH({ value: depositAmount });

      // Prepare a withdrawal of 1 ETH.
      const withdrawAmount = ethers.utils.parseEther("1");
      const auth = {
        amount: withdrawAmount,
        currentBalance: depositAmount,
        newBalance: depositAmount.sub(withdrawAmount),
        // use a dummy gameResultsHash (could be zero)
        gameResultsHash: ethers.constants.HashZero,
        nonce: 1,
      };

      // Sign the message using the current serverSigner.
      const signature = await signWithdrawETH(auth, user, depositContract, chainId, owner);

      // Withdraw and check ETH balance update and event emissions.
      await expect(
        depositContract.connect(user).withdrawETH(auth, signature)
      )
        .to.emit(depositContract, "ETHWithdrawal")
        .withArgs(user.address, withdrawAmount);

      const newBalance = await depositContract.ethDeposits(user.address);
      expect(newBalance).to.equal(auth.newBalance);
    });

    it("should revert ETH withdrawal with an invalid signature", async function () {
      const depositAmount = ethers.utils.parseEther("2");
      await depositContract.connect(user).depositETH({ value: depositAmount });

      const withdrawAmount = ethers.utils.parseEther("1");
      const auth = {
        amount: withdrawAmount,
        currentBalance: depositAmount,
        newBalance: depositAmount.sub(withdrawAmount),
        gameResultsHash: ethers.constants.HashZero,
        nonce: 2,
      };

      // Use an invalid signer (e.g. 'other' instead of the serverSigner).
      const badSignature = await signWithdrawETH(auth, user, depositContract, chainId, other);

      await expect(
        depositContract.connect(user).withdrawETH(auth, badSignature)
      ).to.be.revertedWith("Invalid signature");
    });
  });

  describe("Token Deposits and Withdrawals", function () {
    it("should allow a user to deposit and then withdraw tokens", async function () {
      // User approves token transfer.
      const depositAmount = ethers.utils.parseEther("10");
      await token.connect(user).approve(depositContract.address, depositAmount);

      // Deposit tokens.
      await expect(
        depositContract.connect(user).depositToken(token.address, depositAmount)
      )
        .to.emit(depositContract, "TokenDeposit")
        .withArgs(user.address, token.address, depositAmount);

      const deposited = await depositContract.tokenDeposits(user.address, token.address);
      expect(deposited).to.equal(depositAmount);

      // Prepare token withdrawal.
      const auth = {
        amount: depositAmount.div(2),
        currentBalance: depositAmount,
        newBalance: depositAmount.sub(depositAmount.div(2)),
        gameResultsHash: ethers.constants.HashZero,
        nonce: 1,
      };

      // Sign the withdrawal message.
      const signature = await signWithdrawToken(auth, user, token, depositContract, chainId, owner);

      // Withdraw tokens.
      await expect(
        depositContract.connect(user).withdrawToken(auth, token.address, signature)
      )
        .to.emit(depositContract, "TokenWithdrawal")
        .withArgs(user.address, token.address, auth.amount);

      const newTokenBalance = await depositContract.tokenDeposits(user.address, token.address);
      expect(newTokenBalance).to.equal(auth.newBalance);
    });
  });

  describe("Game Result Update and Tournament", function () {
    it("should update game result and tournament score for ETH games", async function () {
      // Start a tournament.
      const duration = 60; // seconds
      await expect(depositContract.startTournament(duration))
        .to.emit(depositContract, "TournamentStarted");

      // Deposit ETH so that user has a balance.
      const depositAmount = ethers.utils.parseEther("3");
      await depositContract.connect(user).depositETH({ value: depositAmount });

      // Prepare a game result update.
      const game = {
        gameId: ethers.utils.formatBytes32String("game1"),
        newBalance: depositAmount.sub(ethers.utils.parseEther("0.5")).toString(),
        gameResultHash: ethers.constants.HashZero,
        scoreChange: 10,
        fee: ethers.utils.parseEther("0.1"),
      };
      const nonce = 1;

      const signature = await signUpdateGameResult(game, nonce, user, { address: ethers.constants.AddressZero }, depositContract, chainId, owner);

      // Update game result.
      await expect(
        depositContract.connect(user).updateGameResult(
          ethers.constants.AddressZero, // ETH game
          game,
          nonce,
          signature
        )
      )
        .to.emit(depositContract, "GameResultUpdated")
        .withArgs(
          user.address,
          ethers.constants.AddressZero,
          game.gameId,
          game.scoreChange,
          game.gameResultHash
        );

      // Check that the tournament score has been updated and that user is registered as a participant.
      const score = await depositContract.gameScores(user.address);
      expect(score).to.equal(game.scoreChange);

      const isPart = await depositContract.isParticipant(user.address);
      expect(isPart).to.equal(true);

      // Also, rewardPool should have increased by fee.
      const pool = await depositContract.rewardPool();
      expect(pool).to.equal(game.fee);
    });
  });

  describe("Tournament Finalization", function () {
    it("should finalize the tournament and distribute the reward", async function () {
      // Start tournament.
      const duration = 10; // short duration for test
      await depositContract.startTournament(duration);

      // Two users deposit ETH and update game results.
      // user deposits 2 ETH and gets a score of 20.
      const depositUser1 = ethers.utils.parseEther("2");
      await depositContract.connect(user).depositETH({ value: depositUser1 });

      const game1 = {
        gameId: ethers.utils.formatBytes32String("gameUser1"),
        newBalance: depositUser1.sub(ethers.utils.parseEther("0.2")).toString(),
        gameResultHash: ethers.constants.HashZero,
        scoreChange: 20,
        fee: ethers.utils.parseEther("0.1"),
      };
      const nonce1 = 1;
      const sig1 = await signUpdateGameResult(game1, nonce1, user, { address: ethers.constants.AddressZero }, depositContract, chainId, owner);
      await depositContract.connect(user).updateGameResult(
        ethers.constants.AddressZero,
        game1,
        nonce1,
        sig1
      );

      // other deposits 1 ETH and gets a score of 10.
      const depositUser2 = ethers.utils.parseEther("1");
      await depositContract.connect(other).depositETH({ value: depositUser2 });

      const game2 = {
        gameId: ethers.utils.formatBytes32String("gameUser2"),
        newBalance: depositUser2.sub(ethers.utils.parseEther("0.1")).toString(),
        gameResultHash: ethers.constants.HashZero,
        scoreChange: 10,
        fee: ethers.utils.parseEther("0.05"),
      };
      const nonce2 = 1;
      const sig2 = await signUpdateGameResult(game2, nonce2, other, { address: ethers.constants.AddressZero }, depositContract, chainId, owner);
      await depositContract.connect(other).updateGameResult(
        ethers.constants.AddressZero,
        game2,
        nonce2,
        sig2
      );

      // Fast-forward time to pass tournament end time.
      await network.provider.send("evm_increaseTime", [20]);
      await network.provider.send("evm_mine");

      // Finalize tournament. Expect that the user with higher score (user) is the winner.
      const userEthBalanceBefore = await ethers.provider.getBalance(user.address);
      const tx = await depositContract.finalizeTournament();
      const receipt = await tx.wait();

      // Check that tournament ended event is emitted.
      const tournamentEndedEvent = receipt.events.find(e => e.event === "TournamentEnded");
      expect(tournamentEndedEvent.args.winner).to.equal(user.address);

      // The reward pool was accumulated from fees.
      // After finalization, rewardPool should be 0.
      const poolAfter = await depositContract.rewardPool();
      expect(poolAfter).to.equal(0);
    });
  });

  describe("Admin Functions", function () {
    it("should allow the owner to ban and unban an address", async function () {
      await expect(depositContract.banAddress(user.address))
        .to.emit(depositContract, "AddressBanned")
        .withArgs(user.address);
      expect(await depositContract.banned(user.address)).to.equal(true);

      await expect(depositContract.unbanAddress(user.address))
        .to.emit(depositContract, "AddressUnbanned")
        .withArgs(user.address);
      expect(await depositContract.banned(user.address)).to.equal(false);
    });

    it("should pause and unpause the contract", async function () {
      // Only owner can pause.
      await expect(depositContract.pause())
        .to.emit(depositContract, "EmergencyPaused")
        .withArgs(owner.address);

      // While paused, deposit functions should revert.
      await expect(
        depositContract.connect(user).depositETH({ value: ethers.utils.parseEther("1") })
      ).to.be.revertedWith("Pausable: paused");

      // Unpause.
      await expect(depositContract.unpause())
        .to.emit(depositContract, "EmergencyUnpaused")
        .withArgs(owner.address);
    });
  });

  describe("Emergency Withdrawal", function () {
    it("should allow the owner to perform emergency withdrawal", async function () {
      // Deposit some ETH into the contract.
      const depositAmount = ethers.utils.parseEther("1");
      await depositContract.connect(user).depositETH({ value: depositAmount });

      // Owner withdraws ETH.
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      const tx = await depositContract.emergencyWithdraw(ethers.constants.AddressZero, depositAmount);
      await tx.wait();

      // Check that contract balance is reduced.
      const contractBalance = await ethers.provider.getBalance(depositContract.address);
      expect(contractBalance).to.equal(0);
    });
  });
});