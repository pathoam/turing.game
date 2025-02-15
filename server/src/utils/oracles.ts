import { Network, Alchemy } from 'alchemy-sdk';
import { TOKENS, Token } from './balances';

export interface TokenPrice {
    usdPrice: number;
    lastUpdated: number;
}

export class TokenPriceOracle {
    private static instance: TokenPriceOracle;
    private prices: Map<string, TokenPrice>;
    private alchemy: Alchemy;
    private readonly UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private updatePromise: Promise<void> | null = null;

    private constructor(apiKey: string) {
        this.prices = new Map();
        
        // Initialize Alchemy SDK
        const settings = {
            apiKey: apiKey,
            network: Network.ETH_MAINNET, // We'll use mainnet for price feeds
        };
        
        this.alchemy = new Alchemy(settings);
        
        // Initialize with USDC as base
        Object.values(TOKENS).forEach(token => {
            this.prices.set(token.symbol, {
                usdPrice: token.symbol === 'USDC' ? 1 : 0,
                lastUpdated: 0
            });
        });
    }

    public static initialize(apiKey: string): void {
        if (!TokenPriceOracle.instance) {
            TokenPriceOracle.instance = new TokenPriceOracle(apiKey);
        }
    }

    public static getInstance(): TokenPriceOracle {
        if (!TokenPriceOracle.instance) {
            throw new Error('TokenPriceOracle must be initialized with an API key first');
        }
        return TokenPriceOracle.instance;
    }

    public getAlchemyProvider(): Alchemy {
        return this.alchemy;
    }

    public getPrice(symbol: string): number {
        const price = this.prices.get(symbol);
        return price ? price.usdPrice : 0;
    }

    public getAllPrices(): Map<string, number> {
        const current = new Map<string, number>();
        this.prices.forEach((price, symbol) => {
            current.set(symbol, price.usdPrice);
        });
        return current;
    }

    private async fetchTokenPrice(token: Token): Promise<number> {
        try {
            if (token.chain.type === 'evm') {
                const tokenData = await this.alchemy.core.getTokenMetadata(token.address);
                // Use Alchemy's price feed or implement custom price aggregation
                // For now returning placeholder
                return 0;
            } else {
                // Implement Solana token price fetching
                return 0;
            }
        } catch (error) {
            console.error(`Failed to fetch price for ${token.symbol}:`, error);
            return 0;
        }
    }

    private async _updatePrices(): Promise<void> {
        try {
            const now = Date.now();
            const pricePromises = Object.values(TOKENS).map(async token => {
                if (token.symbol === 'USDC') return; // Skip USDC as it's our base
                
                const price = await this.fetchTokenPrice(token);
                this.prices.set(token.symbol, {
                    usdPrice: price,
                    lastUpdated: now
                });
            });

            await Promise.all(pricePromises);
        } catch (error) {
            console.error('Failed to update token prices:', error);
            throw error;
        }
    }

    public async updatePrices(): Promise<void> {
        if (this.updatePromise) return this.updatePromise;
        
        this.updatePromise = this._updatePrices();
        try {
            await this.updatePromise;
        } finally {
            this.updatePromise = null;
        }
    }
}