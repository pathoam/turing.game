import { ChainManager } from '../chainHandler/chainManager';
import dotenv from 'dotenv';
dotenv.config();

export interface Token {
    symbol: string;
    address: string;
    decimals: number;
    chain: Chain;
}

export interface Chain {
    id: number | string;
    name: string;
    type: 'evm' | 'solana';
    nativeToken: string;
    treasuryAddress: string | undefined;
    rpc: {
        url: string;        // Required
        wsUrl: string;      // Required for EVMHandler
        apiKey: string;     // Required for Alchemy/Helius
    };
}

// Example chain configurations
export const CHAINS: Record<string, Chain> = {
    ARBITRUM: {
        id: 42161,
        name: 'Arbitrum',
        type: 'evm' as const,
        nativeToken: 'ETH',
        treasuryAddress: process.env.ARBITRUM_TREASURY_ADDRESS,
        rpc: {
            url: process.env.DRPC_ARBITRUM_URL || process.env.ALCHEMY_ARBITRUM_URL || '',
            wsUrl: process.env.ALCHEMY_ARBITRUM_WS_URL || '',
            apiKey: process.env.ALCHEMY_API_KEY || ''
        }
    },
    BASE: {
        id: 8453,
        name: 'Base',
        type: 'evm' as const,
        nativeToken: 'ETH',
        treasuryAddress: process.env.BASE_TREASURY_ADDRESS,
        rpc: {
            url: process.env.DRPC_BASE_RPC_URL || process.env.ALCHEMY_BASE_URL || '',
            wsUrl: process.env.ALCHEMY_BASE_WS_URL || '',
            apiKey: process.env.ALCHEMY_API_KEY || ''
        }
    },
    // solana: {
    //     id: '4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ',
    //     name: 'Solana',
    //     nativeToken: 'SOL',
    //     rpc: {
    //         url: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    //         wsUrl: `wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    //         apiKey: process.env.HELIUS_API_KEY!
    //     },
    //     type: 'solana' as const,
    //     treasuryAddress: process.env.SOLANA_TREASURY_ADDRESS!
    // }
};

// Define our supported tokens with chain info
export const TOKENS = {
    ARB: {
        symbol: 'ARB',
        address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
        decimals: 18,
        chain: CHAINS.ARBITRUM
    },
    BASE: {
        symbol: 'BASE', 
        address: '0x4200000000000000000000000000000000000006',
        decimals: 18,
        chain: CHAINS.BASE
    },
    ARB_USDC: {
        symbol: 'USDC',
        address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        decimals: 6,
        chain: CHAINS.ARBITRUM
    },
    BASE_USDC: {
        symbol: 'USDC',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        chain: CHAINS.BASE
    },
    SOL: {
        symbol: 'SOL',
        address: 'So11111111111111111111111111111111111111112',
        decimals: 9,
        chain: CHAINS.solana
    },
    SOL_USDC: {
        symbol: 'USDC',
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        chain: CHAINS.solana
    }
} as const;

// export interface ChainBalance {
//     chainId: number | string;
//     amounts: {
//         [tokenAddress: string]: number;
//     };
// }

export class Balances {
    private balances: Map<string, bigint>;  // Store native amounts by token address
    private usdValue: number;
    private chainManager: ChainManager;

    private static rates: Map<string, number> = new Map();
    private static lastRateUpdate: number = 0;
    private static readonly RATE_UPDATE_INTERVAL = 1 * 60 * 1000; // every 1 minute

    constructor(chainManager: ChainManager, initialBalances?: Record<string, string | number>) {
        this.balances = new Map();
        this.usdValue = 0;
        this.chainManager = chainManager;

        if (initialBalances) {
            Object.entries(initialBalances).forEach(([address, amount]) => {
                const token = this.findTokenByAddress(address);
                if (token) {
                    this.balances.set(address, this.toNativeAmount(amount, token.decimals));
                }
            });
        }
        this.calculateUsdValue();
    }

    private findTokenByAddress(address: string): Token | undefined {
        return Object.values(TOKENS).find(t => t.address.toLowerCase() === address.toLowerCase());
    }

    private findTokenBySymbol(symbol: string): Token | undefined {
        return Object.values(TOKENS).find(t => t.symbol === symbol);
    }

    // Convert decimal amount to native amount
    private toNativeAmount(amount: string | number, decimals: number): bigint {
        const decimalAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
        return BigInt(Math.floor(decimalAmount * 10 ** decimals));
    }

    // Convert native amount to decimal amount
    private toDecimalAmount(amount: bigint, decimals: number): number {
        return Number(amount) / 10 ** decimals;
    }

    // Get balance in native units by token address
    public getNativeBalance(tokenAddress: string): bigint {
        return this.balances.get(tokenAddress) ?? BigInt(0);
    }

    // Get balance in decimal units by token address
    public getDecimalBalance(tokenAddress: string): number {
        const token = this.findTokenByAddress(tokenAddress);
        if (!token) return 0;
        
        const nativeAmount = this.balances.get(tokenAddress) ?? BigInt(0);
        return this.toDecimalAmount(nativeAmount, token.decimals);
    }

    // Get balance by token symbol
    public getBalanceBySymbol(symbol: string): number {
        const token = this.findTokenBySymbol(symbol);
        if (!token) return 0;
        return this.getDecimalBalance(token.address);
    }

    // Get all balances in decimal form
    public getAllBalances(): Record<string, number> {
        const result: Record<string, number> = {};
        for (const [address, amount] of this.balances) {
            const token = this.findTokenByAddress(address);
            if (token) {
                result[token.symbol] = this.toDecimalAmount(amount, token.decimals);
            }
        }
        return result;
    }

    // Update a balance by token address
    public updateBalance(tokenAddress: string, newAmount: string | number): void {
        const token = this.findTokenByAddress(tokenAddress);
        if (!token) return;

        this.balances.set(tokenAddress, this.toNativeAmount(newAmount, token.decimals));
        this.calculateUsdValue();
    }

    // Get total USD value of all balances
    public getUsdValue(): number {
        return this.usdValue;
    }

    private async calculateUsdValue(): Promise<void> {
        // TODO: Implement price fetching and USD calculation
        this.usdValue = 0;
        for (const [address, amount] of this.balances) {
            const token = this.findTokenByAddress(address);
            if (token) {
                const price = await this.getTokenPrice(token.symbol);
                const decimalAmount = this.toDecimalAmount(amount, token.decimals);
                this.usdValue += decimalAmount * price;
            }
        }
    }

    private async getTokenPrice(symbol: string): Promise<number> {
        const token = this.findTokenBySymbol(symbol);
        if (!token) return 0;
        
        const handler = this.chainManager.getHandler(token.chain.id);
        if (!handler) return 0;

        const [price] = await handler.getTokenPrices([symbol]);
        return price.usdPrice;
    }
}