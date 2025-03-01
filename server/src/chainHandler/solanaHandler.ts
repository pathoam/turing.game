import { Connection, PublicKey } from '@solana/web3.js';
import { ChainHandler, TransactionResult, BalanceResponse, TokenPrice } from './chainHandler';
import { Chain, Token } from './chains';

interface HeliusAsset {
    id: string;
    content: {
        metadata: {
            symbol: string;
        };
    };
    token_info?: {
        balance: string;
        decimals: number;
    };
}

interface HeliusResponse {
    result: {
        items: HeliusAsset[];
        nativeBalance: {
            lamports: number;
        };
    };
}

interface HeliusAssetResponse {
    result: {
        items: Array<{
            id: string;
            content: {
                metadata: {
                    symbol: string;
                };
            };
            token_info?: {
                price_info?: {
                    price_per_token: number;
                    currency: string;
                };
            };
        }>;
    };
}

export class SolanaHandler extends ChainHandler {
    private connection: Connection;
    private priceCache: Map<string, TokenPrice> = new Map();
    private lastPriceUpdate: number = 0;
    private readonly PRICE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

    constructor(chain: Chain, apiKey: string, treasuryAddress: string) {
        const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
        super(chain, rpcUrl, treasuryAddress);
        this.connection = new Connection(rpcUrl, 'confirmed');
    }

    async getTokenBalances(address: string, tokens: Token[]): Promise<BalanceResponse> {
        try {
            const response = await fetch(this.chain.rpc.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'helius-query',
                    method: 'getAssetsByOwner',
                    params: {
                        ownerAddress: address,
                        displayOptions: {
                            showFungible: true,
                            showNativeBalance: true
                        }
                    }
                })
            });

            const { result } = (await response.json()) as HeliusResponse;
            const balances: BalanceResponse = {};

            // Handle native SOL balance
            const nativeToken = tokens.find(t => t.symbol === 'SOL');
            if (nativeToken) {
                balances[nativeToken.address] = result.nativeBalance.lamports / 10 ** nativeToken.decimals;
            }

            // Handle other tokens
            for (const token of tokens) {
                if (token.symbol === 'SOL') continue;
                
                const asset = result.items.find(item => 
                    item.content?.metadata?.symbol === token.symbol
                );

                if (asset?.token_info) {
                    balances[token.address] = Number(asset.token_info.balance) / 10 ** token.decimals;
                } else {
                    balances[token.address] = 0;
                }
            }

            return balances;
        } catch (error) {
            console.error('Error fetching Solana token balances:', error);
            throw error;
        }
    }

    async getBalance(address: string, token: Token): Promise<number> {
        try {
            if (token.symbol === 'SOL') {
                const pubKey = new PublicKey(address);
                const balance = await this.connection.getBalance(pubKey);
                return balance / 10 ** token.decimals;
            }
            
            // For other tokens, we'll need to use the token program
            // Implementation for SPL tokens
            return 0;
        } catch (error) {
            console.error('Error getting Solana balance:', error);
            throw error;
        }
    }

    async getBalances(address: string, tokens: Token[]): Promise<BalanceResponse> {
        const balances: BalanceResponse = {};
        await Promise.all(
            tokens.map(async (token) => {
                balances[token.address] = await this.getBalance(address, token);
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
            // Implementation for Solana transfers
            // Will need to handle both SOL and SPL token transfers
            return {
                success: false,
                error: 'Not implemented'
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async startEventListener(): Promise<void> {
        // TODO: Implement Solana event listening
        console.log('Solana event listener started');
    }

    async stopEventListener(): Promise<void> {
        // TODO: Clean up any subscriptions
        console.log('Solana event listener stopped');
    }

    async getTokenPrices(symbols: string[]): Promise<TokenPrice[]> {
        const now = Date.now();
        if (now - this.lastPriceUpdate > this.PRICE_UPDATE_INTERVAL) {
            try {
                const response = await fetch(this.rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 'helius-query',
                        method: 'getAssetsByOwner',
                        params: {
                            ownerAddress: this.treasuryAddress,
                            displayOptions: {
                                showFungible: true
                            }
                        }
                    })
                });

                const { result } = await response.json() as HeliusAssetResponse;
                
                result.items.forEach(item => {
                    const symbol = item.content?.metadata?.symbol;
                    const price = item.token_info?.price_info?.price_per_token;
                    
                    if (symbol && price) {
                        this.priceCache.set(symbol, {
                            symbol,
                            usdPrice: price,
                            lastUpdated: now
                        });
                    }
                });

                this.lastPriceUpdate = now;
            } catch (error) {
                console.error('Failed to update Solana token prices:', error);
            }
        }

        return symbols.map(symbol => this.priceCache.get(symbol) || {
            symbol,
            usdPrice: 0,
            lastUpdated: 0
        });
    }
}