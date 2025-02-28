import { ethers, network } from "hardhat";
import { Signer } from "ethers";
import { strict as assert } from "assert";

// Define constants.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const HASH_ZERO = "0x" + "0".repeat(64);

describe("DepositContract - Tournament Funding from Contract Balance", function () {
  let depositContract: any;
  let testToken: any;
  let owner: Signer, user: Signer, other: Signer;
  let chainId: number;

  // Helper to sign the updateGameResult message.
  async function signUpdateGameResult(
    game: { gameId: string; newBalance: any; gameResultHash: string; scoreChange: number },
    nonce: number,
    user: Signer,
    tokenAddress: string,
    contractInstance: any,
    chainId: number,
    signer: Signer
  ) {
    const userAddr = await user.getAddress();
    console.log("signUpdateGameResult: userAddr =", userAddr);
    console.log("signUpdateGameResult: tokenAddress =", tokenAddress);
    console.log("signUpdateGameResult: contract address =", contractInstance.target);
    
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
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
        userAddr,
        tokenAddress,
        game.gameId,
        game.newBalance,
        game.gameResultHash,
        game.scoreChange,
        nonce,
        contractInstance.target,
      ]
    );
    console.log("Encoded message:", encoded);
    const messageHash = ethers.keccak256(encoded);
    console.log("Message hash:", messageHash);
    const bytesMessage = ethers.getBytes(messageHash);
    console.log("Bytes of message hash:", bytesMessage);
    const signature = await signer.signMessage(bytesMessage);
    console.log("Signature:", signature);
    return signature;
  }

  beforeEach(async function () {
    [owner, user, other] = await ethers.getSigners();
    console.log("Owner address:", await owner.getAddress());
    console.log("User address:", await user.getAddress());
    console.log("Other address:", await other.getAddress());

    // Deploy the DepositContract.
    const DepositContractFactory = await ethers.getContractFactory("TuringTournament");
    depositContract = await DepositContractFactory.deploy();
    await depositContract.waitForDeployment(); 
    console.log("DepositContract address:", depositContract.target);

    const networkObj = await ethers.provider.getNetwork();
    chainId = Number(networkObj.chainId);
    console.log("Chain ID:", chainId);

    // Deploy a TestToken contract.
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    testToken = await TestTokenFactory.deploy("TestToken", "TTK", ethers.parseEther("1000"));
    console.log("TestToken deployed at:", testToken.address);

    // Transfer tokens to participants.
    await testToken.transfer(await user.getAddress(), ethers.parseEther("50"));
    await testToken.transfer(await other.getAddress(), ethers.parseEther("50"));
    console.log("Token transfers complete");
  });

  it("should finalize tournament and distribute all ETH and tokens to the highest ranking participant", async function () {
    console.log("=== Starting test: Finalize Tournament ===");

    // --- Start Tournament ---
    const duration = 10; // seconds
    console.log("Starting tournament for duration:", duration);
    await depositContract.startTournament(duration);
    console.log("Tournament started");

    // --- Deposits ---
    // ETH deposits.
    const depositUserETH = ethers.parseEther("2"); // user deposits 2 ETH
    const depositOtherETH = ethers.parseEther("1");  // other deposits 1 ETH
    console.log("Depositing ETH: user deposits", depositUserETH.toString());
    await depositContract.connect(user).depositETH({ value: depositUserETH });
    console.log("User ETH deposit complete");
    console.log("Depositing ETH: other deposits", depositOtherETH.toString());
    await depositContract.connect(other).depositETH({ value: depositOtherETH });
    console.log("Other ETH deposit complete");

    // Token deposits.
    const depositTokenAmount = ethers.parseEther("50");
    console.log("Depositing tokens: user approves", depositTokenAmount.toString());
    console.log("DepositContract address:", depositContract.target);
    console.log("depositTokenAmount:", depositTokenAmount.toString());
    console.log("User address:", await user.getAddress());
    await testToken.connect(user).approve(depositContract.target, depositTokenAmount);
    console.log("User token approval complete");
    console.log("DepositContract target address:", depositContract.target);
    console.log("TestToken target address:", testToken.target);
    console.log("Deposit token amount:", depositTokenAmount.toString());
    console.log("User address:", await user.getAddress());
    await depositContract.connect(user).depositToken(testToken.target, depositTokenAmount);
    console.log("User token deposit complete");
    console.log("Depositing tokens: other approves", depositTokenAmount.toString());
    await testToken.connect(other).approve(depositContract.target, depositTokenAmount);
    console.log("Other token approval complete");
    await depositContract.connect(other).depositToken(testToken.target, depositTokenAmount);
    console.log("Other token deposit complete");

    // --- Update Tournament Performance via Game Results ---
    // We want the user to win by having two wins versus other's one win.
    // For ETH (token = ZERO_ADDRESS):
    let currentBalanceUser = depositUserETH;
    console.log("User game1: currentBalanceUser =", currentBalanceUser.toString());
    const userGame1 = {
      gameId: ethers.encodeBytes32String("userGame1"),
      newBalance: currentBalanceUser + 1n,
      gameResultHash: HASH_ZERO,
      scoreChange: 1,
    };
    console.log("User game1 object:", userGame1);
    const nonceUser1 = 1;
    const sigUser1 = await signUpdateGameResult(
      userGame1,
      nonceUser1,
      user,
      ZERO_ADDRESS,
      depositContract,
      chainId,
      owner
    );
    console.log("User game1 signature:", sigUser1);
    await depositContract.connect(user).updateGameResult(
      ZERO_ADDRESS,
      userGame1,
      nonceUser1,
      sigUser1
    );
    console.log("User game1 updateGameResult complete");

    currentBalanceUser = currentBalanceUser + 1n;
    console.log("User game2: currentBalanceUser =", currentBalanceUser.toString());
    const userGame2 = {
      gameId: ethers.encodeBytes32String("userGame2"),
      newBalance: currentBalanceUser + 1n,
      gameResultHash: HASH_ZERO,
      scoreChange: 1,
    };
    console.log("User game2 object:", userGame2);
    const nonceUser2 = 2;
    const sigUser2 = await signUpdateGameResult(
      userGame2,
      nonceUser2,
      user,
      ZERO_ADDRESS,
      depositContract,
      chainId,
      owner
    );
    console.log("User game2 signature:", sigUser2);
    await depositContract.connect(user).updateGameResult(
      ZERO_ADDRESS,
      userGame2,
      nonceUser2,
      sigUser2
    );
    console.log("User game2 updateGameResult complete");

    // Other: one win.
    const otherGame = {
      gameId: ethers.encodeBytes32String("otherGame"),
      newBalance: depositOtherETH + 1n,
      gameResultHash: HASH_ZERO,
      scoreChange: 1,
    };
    console.log("Other game object:", otherGame);
    const nonceOther = 1;
    const sigOther = await signUpdateGameResult(
      otherGame,
      nonceOther,
      other,
      ZERO_ADDRESS,
      depositContract,
      chainId,
      owner
    );
    console.log("Other game signature:", sigOther);
    await depositContract.connect(other).updateGameResult(
      ZERO_ADDRESS,
      otherGame,
      nonceOther,
      sigOther
    );
    console.log("Other game updateGameResult complete");

    // --- Verify Total Prize Before Finalization ---
    const expectedETHPrize = depositUserETH + depositOtherETH;
    console.log("Expected ETH prize:", expectedETHPrize.toString());
    const contractETHBalanceBefore = await ethers.provider.getBalance(depositContract.target);
    console.log("Contract ETH balance before finalization:", contractETHBalanceBefore.toString());
    assert.strictEqual(
      contractETHBalanceBefore.toString(),
      expectedETHPrize.toString(),
      "Contract ETH balance before finalization does not match expected prize"
    );

    const contractTokenBalanceBefore = await testToken.balanceOf(depositContract.target);
    const expectedTokenBalance = depositTokenAmount * 2n;
    console.log("Expected token balance:", expectedTokenBalance.toString());
    console.log("Contract token balance before finalization:", contractTokenBalanceBefore.toString());
    assert.strictEqual(
      contractTokenBalanceBefore.toString(),
      expectedTokenBalance.toString(),
      "Contract token balance before finalization does not match expected prize"
    );

    // Record winner's balances before finalization.
    const userEthBefore = await ethers.provider.getBalance(await user.getAddress());
    const userTokenBefore = await testToken.balanceOf(await user.getAddress());
    console.log("User ETH balance before finalization:", userEthBefore.toString());
    console.log("User token balance before finalization:", userTokenBefore.toString());

    // --- Finalize Tournament ---
    console.log("Increasing time by 20 seconds and mining a new block...");
    await network.provider.send("evm_increaseTime", [20]);
    await network.provider.send("evm_mine");
    console.log("Time increased, finalizing tournament...");
    const tx = await depositContract.finalizeTournament();
    const receipt = await tx.wait();
    console.log("Tournament finalized, receipt:", receipt);

    // Print the entire receipt object and raw logs
    console.log("Transaction receipt:", receipt);
    console.log("Raw logs:", receipt.logs);

    // Print out decoded events, if any:
    if (receipt.events && receipt.events.length > 0) {
      console.log("Decoded events:");
      receipt.events.forEach((e: any, idx: number) => {
        console.log(`Event ${idx}:`, e.event, e.args);
      });
    } else {
      console.log("No events found in receipt.");
    }


    // Verify the TournamentEnded event.
    let tournamentEndedEvent;
    for (const log of receipt.logs) {
      try {
        const parsedLog = depositContract.interface.parseLog(log);
        if (parsedLog.name === "TournamentEnded") {
          tournamentEndedEvent = parsedLog;
          break;
        }
      } catch (e) {
        // This log doesn't match our event signature, ignore it.
      }
    }

    console.log("TournamentEnded event:", tournamentEndedEvent);
    assert.ok(tournamentEndedEvent, "TournamentEnded event not found");
    const winner = tournamentEndedEvent.args.winner;
    const expectedWinner = await user.getAddress();
    console.log("Winner from event:", winner, "; Expected winner:", expectedWinner);
    assert.strictEqual(winner, expectedWinner, "Winner is not the expected user");

    // Verify contract balances are now zero.
    const contractETHBalanceAfter = await ethers.provider.getBalance(depositContract.target);
    console.log("Contract ETH balance after finalization:", contractETHBalanceAfter.toString());
    assert.strictEqual(
      contractETHBalanceAfter.toString(),
      "0",
      "Contract ETH balance after finalization is not zero"
    );
    const contractTokenBalanceAfter = await testToken.balanceOf(depositContract.target);
    console.log("Contract token balance after finalization:", contractTokenBalanceAfter.toString());
    assert.strictEqual(
      contractTokenBalanceAfter.toString(),
      "0",
      "Contract token balance after finalization is not zero"
    );

    // Verify winner received the prize.
    const userEthAfter = await ethers.provider.getBalance(await user.getAddress());
    console.log("User ETH balance after finalization:", userEthAfter.toString());
    const tolerance = ethers.parseEther("0.01");
    const expectedUserEth = userEthBefore + expectedETHPrize - tolerance;
    console.log("Expected minimum user ETH balance after (within tolerance):", expectedUserEth.toString());
    assert.ok(
      userEthAfter > expectedUserEth,
      "Winner did not receive the expected ETH prize (within tolerance)"
    );

    const userTokenAfter = await testToken.balanceOf(await user.getAddress());
    const expectedUserToken = userTokenBefore + depositTokenAmount * 2n;
    console.log("User token balance after finalization:", userTokenAfter.toString());
    console.log("Expected user token balance after:", expectedUserToken.toString());
    assert.strictEqual(
      userTokenAfter.toString(),
      expectedUserToken.toString(),
      "Winner did not receive the expected token prize"
    );
  });
});
