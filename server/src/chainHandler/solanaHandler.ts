import { Connection } from '@solana/web3.js';
import { ChainHandler, TransactionResult, BalanceResponse } from './chainHandler';
import { Chain, Token } from '../utils/balances';

export class SolanaHandler extends ChainHandler {
    private connection: Connection;

    constructor(chain: Chain, apiKey: string) {
        const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
        super(chain, rpcUrl);
        this.connection = new Connection(rpcUrl, 'confirmed');
    }

    async getBalance(address: string, token: Token): Promise<number> {
        try {
            if (token.symbol === 'SOL') {
                const balance = await this.connection.getBalance(address);
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
}