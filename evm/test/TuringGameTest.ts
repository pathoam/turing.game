import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Signer } from "ethers";

describe("DepositContract", function () {
  let depositContract: any;
  let owner: Signer, user: Signer, other: Signer, serverSigner: Signer;
  let chainId: number;
  let token: any;

  // Helper: sign message for withdrawETH.
  async function signWithdrawETH(
    auth: { amount: any; currentBalance: any; newBalance: any; gameResultsHash: any; nonce: number },
    user: any,
    contract: any,
    chainId: number,
    signer: Signer
  ) {
    const encodedAuth = ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256", "uint256", "bytes32", "uint256"],
      [auth.amount, auth.currentBalance, auth.newBalance, auth.gameResultsHash, auth.nonce]
    );
    const message = ethers.utils.defaultAbiCoder.encode(
      ["string", "uint256", "address", "bytes", "address"],
      ["withdrawETH", chainId, await user.getAddress(), encodedAuth, contract.address]
    );
    const messageHash = ethers.utils.keccak256(message);
    return await signer.signMessage(ethers.utils.arrayify(messageHash));
  }

  // Helper: sign message for withdrawToken.
  async function signWithdrawToken(
    auth: { amount: any; currentBalance: any; newBalance: any; gameResultsHash: any; nonce: number },
    user: any,
    token: any,
    contract: any,
    chainId: number,
    signer: Signer
  ) {
    const encodedAuth = ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256", "uint256", "bytes32", "uint256"],
      [auth.amount, auth.currentBalance, auth.newBalance, auth.gameResultsHash, auth.nonce]
    );
    const message = ethers.utils.defaultAbiCoder.encode(
      ["string", "uint256", "address", "address", "bytes", "address"],
      ["withdrawToken", chainId, await user.getAddress(), token.address, encodedAuth, contract.address]
    );
    const messageHash = ethers.utils.keccak256(message);
    return await signer.signMessage(ethers.utils.arrayify(messageHash));
  }

  // Helper: sign message for updateGameResult.
  async function signUpdateGameResult(
    game: { gameId: string; newBalance: any; gameResultHash: any; scoreChange: number },
    nonce: number,
    user: any,
    token: { address: string },
    contract: any,
    chainId: number,
    signer: Signer
  ) {
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
        "address",
      ],
      [
        "updateGame",
        chainId,
        await user.getAddress(),
        token.address,
        game.gameId,
        game.newBalance,
        game.gameResultHash,
        game.scoreChange,
        nonce,
        contract.address,
      ]
    );
    const messageHash = ethers.utils.keccak256(message);
    return await signer.signMessage(ethers.utils.arrayify(messageHash));
  }

  beforeEach(async function () {
    [owner, user, other, serverSigner] = await ethers.getSigners();

    // Deploy DepositContract.
    const DepositContractFactory = await ethers.getContractFactory("DepositContract");
    depositContract = await DepositContractFactory.deploy();

    const networkObj = await ethers.provider.getNetwork();
    chainId = networkObj.chainId;

    // Deploy TestToken contract.
    // Make sure you have a TestToken contract (e.g., inheriting from OpenZeppelin's ERC20) in your contracts folder.
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    token = await TestTokenFactory.deploy("TestToken", "TTK", ethers.utils.parseEther("1000"));
    await token.deployed();

    // Transfer some tokens to the user.
    await token.transfer(await user.getAddress(), ethers.utils.parseEther("100"));
  });

  describe("ETH Deposits and Withdrawals", function () {
    it("should allow a user to deposit ETH", async function () {
      const depositAmount = ethers.utils.parseEther("1");
      await expect(depositContract.connect(user).depositETH({ value: depositAmount }))
        .to.emit(depositContract, "ETHDeposit")
        .withArgs(await user.getAddress(), depositAmount);

      const balance = await depositContract.ethDeposits(await user.getAddress());
      expect(balance).to.equal(depositAmount);
    });

    it("should allow a user to withdraw ETH with a valid signature", async function () {
      // Deposit ETH.
      const depositAmount = ethers.utils.parseEther("2");
      await depositContract.connect(user).depositETH({ value: depositAmount });

      // Prepare withdrawal of 1 ETH.
      const withdrawAmount = ethers.utils.parseEther("1");
      const auth = {
        amount: withdrawAmount,
        currentBalance: depositAmount,
        newBalance: depositAmount.sub(withdrawAmount),
        gameResultsHash: ethers.constants.HashZero,
        nonce: 1,
      };

      // Sign the withdrawal message using the current serverSigner (owner by default).
      const signature = await signWithdrawETH(auth, user, depositContract, chainId, owner);

      await expect(depositContract.connect(user).withdrawETH(auth, signature))
        .to.emit(depositContract, "ETHWithdrawal")
        .withArgs(await user.getAddress(), withdrawAmount);

      const newBalance = await depositContract.ethDeposits(await user.getAddress());
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

      // Use a signature signed by 'other' (an invalid signer).
      const badSignature = await signWithdrawETH(auth, user, depositContract, chainId, other);

      await expect(depositContract.connect(user).withdrawETH(auth, badSignature))
        .to.be.revertedWith("Invalid signature");
    });
  });

  describe("Token Deposits and Withdrawals", function () {
    it("should allow a user to deposit and then withdraw tokens", async function () {
      const depositAmount = ethers.utils.parseEther("10");
      await token.connect(user).approve(depositContract.address, depositAmount);

      await expect(depositContract.connect(user).depositToken(token.address, depositAmount))
        .to.emit(depositContract, "TokenDeposit")
        .withArgs(await user.getAddress(), token.address, depositAmount);

      const deposited = await depositContract.tokenDeposits(await user.getAddress(), token.address);
      expect(deposited).to.equal(depositAmount);

      const auth = {
        amount: depositAmount.div(2),
        currentBalance: depositAmount,
        newBalance: depositAmount.sub(depositAmount.div(2)),
        gameResultsHash: ethers.constants.HashZero,
        nonce: 1,
      };

      const signature = await signWithdrawToken(auth, user, token, depositContract, chainId, owner);
      await expect(depositContract.connect(user).withdrawToken(auth, token.address, signature))
        .to.emit(depositContract, "TokenWithdrawal")
        .withArgs(await user.getAddress(), token.address, auth.amount);

      const newTokenBalance = await depositContract.tokenDeposits(await user.getAddress(), token.address);
      expect(newTokenBalance).to.equal(auth.newBalance);
    });
  });

  describe("Game Result Update and Tournament", function () {
    it("should update game result and tournament score for ETH games", async function () {
      // Start a tournament.
      const duration = 60; // seconds
      await expect(depositContract.startTournament(duration))
        .to.emit(depositContract, "TournamentStarted");

      // Deposit ETH so the user has a balance.
      const depositAmount = ethers.utils.parseEther("3");
      await depositContract.connect(user).depositETH({ value: depositAmount });

      // Prepare a game result update (for an ETH game, so token is address(0)).
      const game = {
        gameId: ethers.utils.formatBytes32String("game1"),
        newBalance: depositAmount.sub(ethers.utils.parseEther("0.5")).toString(),
        gameResultHash: ethers.constants.HashZero,
        scoreChange: 10,
      };
      const nonce = 1;
      const signature = await signUpdateGameResult(
        game,
        nonce,
        user,
        { address: ethers.constants.AddressZero },
        depositContract,
        chainId,
        owner
      );

      await expect(
        depositContract.connect(user).updateGameResult(
          ethers.constants.AddressZero,
          game,
          nonce,
          signature
        )
      )
        .to.emit(depositContract, "GameResultUpdated")
        .withArgs(
          await user.getAddress(),
          ethers.constants.AddressZero,
          game.gameId,
          game.scoreChange,
          game.gameResultHash
        );

      // Verify tournament score and participant registration.
      const score = await depositContract.gameScores(await user.getAddress());
      expect(score).to.equal(game.scoreChange);
      const isPart = await depositContract.isParticipant(await user.getAddress());
      expect(isPart).to.equal(true);
    });
  });

  describe("Tournament Finalization", function () {
    it("should finalize the tournament and distribute the prize", async function () {
      // Fund the tournament prize pool.
      const prizeFund = ethers.utils.parseEther("5");
      await depositContract.connect(owner).fundTournamentPrizePool({ value: prizeFund });

      // Start tournament.
      const duration = 10; // seconds
      await depositContract.startTournament(duration);

      // User deposits 2 ETH and gets a score of 20.
      const depositUser1 = ethers.utils.parseEther("2");
      await depositContract.connect(user).depositETH({ value: depositUser1 });
      const game1 = {
        gameId: ethers.utils.formatBytes32String("gameUser1"),
        newBalance: depositUser1.sub(ethers.utils.parseEther("0.2")).toString(),
        gameResultHash: ethers.constants.HashZero,
        scoreChange: 20,
      };
      const nonce1 = 1;
      const sig1 = await signUpdateGameResult(
        game1,
        nonce1,
        user,
        { address: ethers.constants.AddressZero },
        depositContract,
        chainId,
        owner
      );
      await depositContract.connect(user).updateGameResult(ethers.constants.AddressZero, game1, nonce1, sig1);

      // Other deposits 1 ETH and gets a score of 10.
      const depositUser2 = ethers.utils.parseEther("1");
      await depositContract.connect(other).depositETH({ value: depositUser2 });
      const game2 = {
        gameId: ethers.utils.formatBytes32String("gameUser2"),
        newBalance: depositUser2.sub(ethers.utils.parseEther("0.1")).toString(),
        gameResultHash: ethers.constants.HashZero,
        scoreChange: 10,
      };
      const nonce2 = 1;
      const sig2 = await signUpdateGameResult(
        game2,
        nonce2,
        other,
        { address: ethers.constants.AddressZero },
        depositContract,
        chainId,
        owner
      );
      await depositContract.connect(other).updateGameResult(ethers.constants.AddressZero, game2, nonce2, sig2);

      // Fast-forward time to after tournament end.
      await network.provider.send("evm_increaseTime", [20]);
      await network.provider.send("evm_mine");

      const tx = await depositContract.finalizeTournament();
      const receipt = await tx.wait();

      // Verify that the TournamentEnded event indicates the user with the higher score won.
      const tournamentEndedEvent = receipt.events.find((e: any) => e.event === "TournamentEnded");
      expect(tournamentEndedEvent.args.winner).to.equal(await user.getAddress());

      // The prize pool should now be 0.
      const prizePoolAfter = await depositContract.tournamentPrizePool();
      expect(prizePoolAfter).to.equal(0);
    });
  });

  describe("Admin Functions", function () {
    it("should allow the owner to ban and unban an address", async function () {
      await expect(depositContract.connect(owner).banAddress(await user.getAddress()))
        .to.emit(depositContract, "AddressBanned")
        .withArgs(await user.getAddress());
      expect(await depositContract.banned(await user.getAddress())).to.equal(true);

      await expect(depositContract.connect(owner).unbanAddress(await user.getAddress()))
        .to.emit(depositContract, "AddressUnbanned")
        .withArgs(await user.getAddress());
      expect(await depositContract.banned(await user.getAddress())).to.equal(false);
    });

    it("should pause and unpause the contract", async function () {
      await expect(depositContract.connect(owner).pause())
        .to.emit(depositContract, "EmergencyPaused")
        .withArgs(await owner.getAddress());

      await expect(
        depositContract.connect(user).depositETH({ value: ethers.utils.parseEther("1") })
      ).to.be.revertedWith("Pausable: paused");

      await expect(depositContract.connect(owner).unpause())
        .to.emit(depositContract, "EmergencyUnpaused")
        .withArgs(await owner.getAddress());
    });
  });

  describe("Emergency Withdrawal", function () {
    it("should allow the owner to perform emergency withdrawal", async function () {
      const depositAmount = ethers.utils.parseEther("1");
      await depositContract.connect(user).depositETH({ value: depositAmount });

      const tx = await depositContract.connect(owner).emergencyWithdraw(ethers.constants.AddressZero, depositAmount);
      await tx.wait();

      const contractBalance = await ethers.provider.getBalance(depositContract.address);
      expect(contractBalance).to.equal(0);
    });
  });
});
