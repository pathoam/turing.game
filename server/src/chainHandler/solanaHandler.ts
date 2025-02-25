import { Connection, PublicKey } from '@solana/web3.js';
import { ChainHandler, TransactionResult, BalanceResponse } from './chainHandler';
import { Chain, Token } from '../utils/balances';

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

export class SolanaHandler extends ChainHandler {
    private connection: Connection;

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
}