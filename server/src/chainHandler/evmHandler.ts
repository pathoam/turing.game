import { ethers } from 'ethers';
import { ChainHandler, TransactionResult, BalanceResponse } from './chainHandler';
import { Chain, Token } from '../utils/balances';

// Standard ERC20 ABI for balance and transfer methods
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
];

export class EVMHandler extends ChainHandler {
    private provider: ethers.JsonRpcProvider;

    constructor(chain: Chain, rpcUrl: string) {
        super(chain, rpcUrl);
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }

    async getBalance(address: string, token: Token): Promise<number> {
        try {
            // Handle native token (ETH)
            if (token.address === '0x0000000000000000000000000000000000000000') {
                const balance = await this.provider.getBalance(address);
                return Number(ethers.formatUnits(balance, token.decimals));
            }
            
            // Handle ERC20 tokens
            const contract = new ethers.Contract(token.address, ERC20_ABI, this.provider);
            const balance = await contract.balanceOf(address);
            return Number(ethers.formatUnits(balance, token.decimals));
        } catch (error) {
            console.error(`Error getting ${token.symbol} balance:`, error);
            throw error;
        }
    }

    async getBalances(address: string, tokens: Token[]): Promise<BalanceResponse> {
        const balances: BalanceResponse = {};
        await Promise.all(
            tokens.map(async (token) => {
                try {
                    balances[token.address] = await this.getBalance(address, token);
                } catch (error) {
                    console.error(`Failed to get balance for token ${token.symbol}:`, error);
                    balances[token.address] = 0;
                }
            })
        );
        return balances;
    }

    async transfer(
        from: string,
        to: string,
        token: Token,
        amount: number
    ): Promise<TransactionResult> {
        try {
            // Get the wallet using private key (this would need to be provided securely)
            const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);
            
            // Handle native token transfer
            if (token.address === '0x0000000000000000000000000000000000000000') {
                const tx = await wallet.sendTransaction({
                    to,
                    value: ethers.parseUnits(amount.toString(), token.decimals)
                });
                const receipt = await tx.wait();
                return {
                    success: true,
                    hash: receipt?.hash
                };
            }
            
            // Handle ERC20 transfer
            const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);
            const tx = await contract.transfer(
                to,
                ethers.parseUnits(amount.toString(), token.decimals)
            );
            const receipt = await tx.wait();
            
            return {
                success: true,
                hash: receipt?.hash
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error during transfer'
            };
        }
    }

    // Helper method to estimate gas costs
    async estimateTransferGas(
        from: string,
        to: string,
        token: Token,
        amount: number
    ): Promise<bigint> {
        if (token.address === '0x0000000000000000000000000000000000000000') {
            return await this.provider.estimateGas({
                from,
                to,
                value: ethers.parseUnits(amount.toString(), token.decimals)
            });
        }
        
        const contract = new ethers.Contract(token.address, ERC20_ABI, this.provider);
        return await contract.transfer.estimateGas(
            to,
            ethers.parseUnits(amount.toString(), token.decimals)
        );
    }

    // Helper to get current gas price
    async getGasPrice(): Promise<bigint> {
        return await this.provider.getFeeData().then(data => data.gasPrice ?? 0n);
    }
}