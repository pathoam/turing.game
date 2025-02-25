import { ethers } from 'ethers';
import { ChainHandler, TransactionResult, BalanceResponse, TransactionEvent } from './chainHandler';
import { Chain, Token } from '../utils/balances';
import { WebSocketProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { Alchemy, Network } from 'alchemy-sdk';

// Standard ERC20 ABI for balance and transfer methods
const ERC20_ABI = [
    'event Transfer(address indexed from, address indexed to, uint256 amount)',
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)'
];

export class EVMHandler extends ChainHandler {
    private wsProvider: WebSocketProvider;
    private provider: ethers.JsonRpcProvider;  // For transactions
    private contracts: Map<string, Contract> = new Map();
    private alchemy: Alchemy;

    constructor(chain: Chain, rpcUrl: string, treasuryAddress: string) {
        super(chain, rpcUrl, treasuryAddress);
        this.wsProvider = new WebSocketProvider(chain.rpc.wsUrl);
        this.provider = new ethers.JsonRpcProvider(chain.rpc.url);
        
        // Initialize Alchemy SDK
        this.alchemy = new Alchemy({
            apiKey: chain.rpc.apiKey,
            network: this.getAlchemyNetwork(chain.id)
        });
    }

    private getAlchemyNetwork(chainId: string | number): Network {
        switch(chainId) {
            case 42161: return Network.ARB_MAINNET;
            case 8453: return Network.BASE_MAINNET;
            default: throw new Error(`Unsupported chain ID: ${chainId}`);
        }
    }

    async startEventListener(): Promise<void> {
        // Listen for new blocks
        this.wsProvider.on('block', (blockNumber) => {
            console.log(`New block on ${this.chain.name}: ${blockNumber}`);
        });

        // Set up token transfer listeners
        this.wsProvider.on({
            address: this.treasuryAddress,
            topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event topic
            ]
        }, (log) => {
            // Process transfer event
            const event: TransactionEvent = {
                chainId: this.getChainId().toString(),
                from: log.topics[1],
                to: log.topics[2],
                tokenSymbol: 'ETH', // Need to look up actual token
                amount: parseInt(log.data),
                txHash: log.transactionHash
            };

            if (log.address === this.treasuryAddress) {
                this.emitDeposit(event);
            }
        });
    }

    async stopEventListener(): Promise<void> {
        await this.wsProvider.destroy();
    }

    async getBalance(address: string, token: Token): Promise<number> {
        try {
            // Handle native token (ETH)
            if (token.address === '0x0000000000000000000000000000000000000000') {
                const balance = await this.provider.getBalance(address);
                return Number(ethers.formatUnits(BigInt(balance.toString()), token.decimals));
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

    async getTokenBalances(address: string, tokens: Token[]): Promise<BalanceResponse> {
        try {
            // Filter for ERC20 tokens only
            const tokenAddresses = tokens
                .filter(t => t.address !== '0x0000000000000000000000000000000000000000')
                .map(t => t.address);

            const response = await this.alchemy.core.getTokenBalances(address, tokenAddresses);
            
            const balances: BalanceResponse = {};
            response.tokenBalances.forEach((balance, i) => {
                const token = tokens[i];
                if (!balance.error && balance.tokenBalance) {
                    balances[token.address] = Number(
                        ethers.formatUnits(BigInt(balance.tokenBalance), token.decimals)
                    );
                } else {
                    balances[token.address] = 0;
                }
            });

            // Add native token balance
            const nativeToken = tokens.find(t => 
                t.address === '0x0000000000000000000000000000000000000000'
            );
            if (nativeToken) {
                const balance = await this.provider.getBalance(address);
                balances[nativeToken.address] = Number(
                    ethers.formatUnits(balance, nativeToken.decimals)
                );
            }

            return balances;
        } catch (error) {
            console.error('Error fetching token balances:', error);
            throw error;
        }
    }
}