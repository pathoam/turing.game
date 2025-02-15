import { Chain, Token } from '../utils/balances';

export interface TransactionResult {
    success: boolean;
    hash?: string;
    error?: string;
}

export interface BalanceResponse {
    [tokenAddress: string]: number;
}

export abstract class ChainHandler {
    protected chain: Chain;
    protected rpcUrl: string;

    constructor(chain: Chain, rpcUrl: string) {
        this.chain = chain;
        this.rpcUrl = rpcUrl;
    }

    abstract getBalance(address: string, token: Token): Promise<number>;
    abstract getBalances(address: string, tokens: Token[]): Promise<BalanceResponse>;
    abstract transfer(
        from: string,
        to: string,
        token: Token,
        amount: number
    ): Promise<TransactionResult>;
    
    // Helper methods that might be useful across chains
    public getChainId(): string | number {
        return this.chain.id;
    }

    public getChainName(): string {
        return this.chain.name;
    }

    public getNativeToken(): string {
        return this.chain.nativeToken;
    }
}