import { EventEmitter } from 'events';
import { CHAINS, Chain, Token } from '../utils/balances';
import { EVMHandler } from './evmHandler';
import { SolanaHandler } from './solanaHandler';
import { ChainHandler, TransactionEvent, TransactionResult } from './chainHandler';
import { ArbitrumHandler } from './arbitrumHandler';
import { BaseHandler } from './baseHandler';

export class ChainManager extends EventEmitter {
    private static instance: ChainManager;
    private handlers: Map<string, ChainHandler> = new Map();

    private constructor() {
        super();
    }

    public static getInstance(): ChainManager {
        if (!ChainManager.instance) {
            ChainManager.instance = new ChainManager();
        }
        return ChainManager.instance;
    }

    async initialize() {
        for (const chain of Object.values(CHAINS)) {
            const handler: ChainHandler = chain.type === 'evm'
                ? (chain.id === 42161 
                    ? new ArbitrumHandler(chain, chain.rpc.url, chain.treasuryAddress)
                    : chain.id === 8453
                        ? new BaseHandler(chain, chain.rpc.url, chain.treasuryAddress)
                        : new EVMHandler(chain, chain.rpc.url, chain.treasuryAddress))
                : new SolanaHandler(chain, chain.rpc.url, chain.treasuryAddress);

            handler.on('depositDetected', (event: TransactionEvent) => {
                this.emit('depositDetected', event);
            });

            await handler.startEventListener();
            this.handlers.set(chain.id.toString(), handler);
            
            console.log(`Initialized ${chain.name} handler with treasury ${chain.treasuryAddress}`);
        }
    }

    // Methods from old ChainManager
    async getBalance(address: string, token: Token): Promise<number> {
        const handler = this.handlers.get(token.chain.id.toString());
        if (!handler) {
            throw new Error(`No handler found for chain ${token.chain.id}`);
        }
        return handler.getBalance(address, token);
    }

    async transfer(
        chainId: string | number,
        to: string,
        token: Token,
        amount: number
    ): Promise<TransactionResult> {
        const handler = this.handlers.get(chainId.toString());
        if (!handler) {
            throw new Error(`No handler found for chain ${chainId}`);
        }
        return handler.transfer(token.chain.treasuryAddress, to, token, amount);
    }

    async shutdown() {
        for (const handler of this.handlers.values()) {
            await handler.stopEventListener();
        }
    }

    public getHandler(chainId: string | number): ChainHandler | undefined {
        return this.handlers.get(chainId.toString());
    }
} 