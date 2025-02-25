import { Chain, Token } from '../utils/balances';
import { EventEmitter } from 'events';

export interface TransactionResult {
    success: boolean;
    hash?: string;
    error?: string;
}

export interface BalanceResponse {
    [tokenAddress: string]: number;
}

export interface TransactionEvent {
    chainId: string;
    from: string;
    to: string;
    tokenSymbol: string;
    amount: number;
    txHash: string;
}

export interface TokenPrice {
    symbol: string;
    usdPrice: number;
    lastUpdated: number;
}

export abstract class ChainHandler extends EventEmitter {
    protected readonly chain: Chain;
    protected readonly treasuryAddress: string;
    protected readonly rpcUrl: string;

    constructor(chain: Chain, rpcUrl: string, treasuryAddress: string) {
        super();
        this.chain = chain;
        this.rpcUrl = rpcUrl;
        this.treasuryAddress = treasuryAddress;
    }

    abstract startEventListener(): Promise<void>;
    abstract stopEventListener(): Promise<void>;
    abstract getBalance(address: string, token: Token): Promise<number>;
    abstract getBalances(address: string, tokens: Token[]): Promise<BalanceResponse>;
    abstract transfer(
        from: string,
        to: string, 
        token: Token, 
        amount: number
    ): Promise<TransactionResult>;
    abstract getTokenBalances(address: string, tokens: Token[]): Promise<BalanceResponse>;
    abstract getTokenPrices(symbols: string[]): Promise<TokenPrice[]>;

    protected emitDeposit(event: TransactionEvent) {
        if (event.to === this.treasuryAddress) {
            this.emit('depositDetected', event);
        }
    }

    protected emitWithdrawal(event: TransactionEvent) {
        if (event.from === this.treasuryAddress) {
            this.emit('withdrawalDetected', event);
        }
    }

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