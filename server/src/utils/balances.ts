export interface Token {
    address: string;
    symbol: string;
    decimals: number;
}

export interface Chain {
    id: string | number;
    name: string;
    nativeToken: string;
    rpc: {
        url: string;     // HTTP URL
        wsUrl: string;   // WebSocket URL
        apiKey: string;  // API key
    };
    type: 'evm' | 'solana';
}

// Example chain configurations
export const CHAINS: Record<string, Chain> = {
    arbitrum: {
        id: 42161,
        name: 'Arbitrum',
        nativeToken: 'ETH',
        rpc: {
            url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_ARBITRUM_KEY}`,
            wsUrl: `wss://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_ARBITRUM_KEY}`,
            apiKey: process.env.ALCHEMY_ARBITRUM_KEY!
        },
        type: 'evm'
    },
    base: {
        id: 8453,
        name: 'Base',
        nativeToken: 'ETH',
        rpc: {
            url: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_BASE_KEY}`,
            wsUrl: `wss://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_BASE_KEY}`,
            apiKey: process.env.ALCHEMY_BASE_KEY!
        },
        type: 'evm'
    },
    solana: {
        id: '4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ',
        name: 'Solana',
        nativeToken: 'SOL',
        rpc: {
            url: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
            wsUrl: `wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
            apiKey: process.env.HELIUS_API_KEY!
        },
        type: 'solana'
    }
};

export interface Token {
    symbol: string;
    address: string;
    decimals: number;
    chain: Chain;
}

// Define our supported tokens with chain info
export const TOKENS = {
    ARB: {
        symbol: 'ARB',
        address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
        decimals: 18,
        chain: CHAINS.arbitrum
    },
    BASE: {
        symbol: 'BASE', 
        address: '0x4200000000000000000000000000000000000006',
        decimals: 18,
        chain: CHAINS.base
    },
    ARB_USDC: {
        symbol: 'USDC',
        address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        decimals: 6,
        chain: CHAINS.arbitrum
    },
    BASE_USDC: {
        symbol: 'USDC',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        chain: CHAINS.base
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
    },
    TURING: {
        symbol: 'TURING',
        address: 'tuRinGx3gVuGbXwYtKsxR8xz6JQVGbZrEBGkZwyTDt1v',
        decimals: 9,
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
    private balances: Map<string, bigint>;  // Store native amounts
    private usdValue: number;

    private static rates: Map<string, number> = new Map();
    private static lastRateUpdate: number = 0;
    private static readonly RATE_UPDATE_INTERVAL = 1 * 60 * 1000; // every 1 minute

    constructor(initialBalances?: { [tokenAddress: string]: string | number }) {
        this.balances = new Map();
        this.usdValue = 0;

        if (initialBalances) {
            Object.entries(initialBalances).forEach(([address, amount]) => {
                const token = Object.values(TOKENS).find(t => t.address === address);
                if (token) {
                    // Convert to native amount and store
                    this.balances.set(address, this.toNativeAmount(amount, token.decimals));
                }
            });
        }
        this.calculateUsdValue();
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

    // Get balance in native units
    public getNativeBalance(tokenAddress: string): bigint {
        return this.balances.get(tokenAddress) ?? BigInt(0);
    }

    // Get balance in decimal units
    public getDecimalBalance(tokenAddress: string): number {
        const token = Object.values(TOKENS).find(t => t.address === tokenAddress);
        if (!token) return 0;
        
        const nativeAmount = this.balances.get(tokenAddress) ?? BigInt(0);
        return this.toDecimalAmount(nativeAmount, token.decimals);
    }

    // Get balance by token symbol
    public getBalanceBySymbol(symbol: string): number {
        const token = Object.values(TOKENS).find(t => t.symbol === symbol);
        if (!token) return 0;
        return this.getDecimalBalance(token.address);
    }

    // Update balance
    public setBalance(tokenAddress: string, amount: string | number | bigint): void {
        const token = Object.values(TOKENS).find(t => t.address === tokenAddress);
        if (!token) return;

        let nativeAmount: bigint;
        if (typeof amount === 'bigint') {
            nativeAmount = amount;
        } else {
            nativeAmount = this.toNativeAmount(amount, token.decimals);
        }
        
        this.balances.set(tokenAddress, nativeAmount);
        this.calculateUsdValue();
    }

    // Static rate management
    public static async updateRates(): Promise<void> {
        const now = Date.now();
        if (now - Balances.lastRateUpdate < Balances.RATE_UPDATE_INTERVAL) {
            return;
        }

        try {
            // Implement rate fetching from an oracle or price feed
            // For now using placeholder static rates
            Balances.rates.set('SOL', 20);
            Balances.rates.set('ETH', 2000);
            Balances.rates.set('USDC', 1);
            Balances.lastRateUpdate = now;
        } catch (error) {
            console.error('Failed to update token rates:', error);
        }
    }

    private calculateUsdValue(): void {
        this.usdValue = Array.from(this.balances.entries()).reduce((total, [address, amount]) => {
            const token = Object.values(TOKENS).find(t => t.address === address);
            if (token && Balances.rates.has(token.symbol)) {
                const decimalAmount = this.toDecimalAmount(amount, token.decimals);
                return total + (decimalAmount * (Balances.rates.get(token.symbol) ?? 0));
            }
            return total;
        }, 0);
    }

    public getUsdValue(): number {
        return this.usdValue;
    }

    public toJSON(): { [tokenAddress: string]: string } {
        const result: { [tokenAddress: string]: string } = {};
        this.balances.forEach((amount, address) => {
            result[address] = amount.toString();
        });
        return result;
    }
}