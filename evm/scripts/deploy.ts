import { ethers } from "hardhat";

async function main() {
  // Get the deployer's account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Get deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");

  // Get the current block
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  if (!block) throw new Error("Failed to get block");
  
  // Deploy the DepositContract
  const DepositContract = await ethers.getContractFactory("DepositContract");
  const depositContract = await DepositContract.deploy();
  await depositContract.waitForDeployment();

  const address = await depositContract.getAddress();
  console.log("DepositContract deployed to:", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
