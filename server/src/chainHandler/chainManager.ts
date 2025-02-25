import { EventEmitter } from 'events';
import { CHAINS, Chain, Token } from '../utils/balances';
import { EVMHandler } from './evmHandler';
import { SolanaHandler } from './solanaHandler';
import { ChainHandler, TransactionEvent, TransactionResult } from './chainHandler';

export class ChainManager extends EventEmitter {
    private static instance: ChainManager;
    private handlers: Map<string, ChainHandler> = new Map();
    private treasuryAddresses: Record<string, string>;

    private constructor(treasuryAddresses: Record<string, string>) {
        super();
        this.treasuryAddresses = treasuryAddresses;
    }

    public static getInstance(treasuryAddresses?: Record<string, string>): ChainManager {
        if (!ChainManager.instance) {
            if (!treasuryAddresses) {
                throw new Error('ChainManager needs treasury addresses for first initialization');
            }
            ChainManager.instance = new ChainManager(treasuryAddresses);
        }
        return ChainManager.instance;
    }

    async initialize() {
        for (const [chainKey, chain] of Object.entries(CHAINS)) {
            const treasuryAddress = this.treasuryAddresses[chainKey];
            if (!treasuryAddress) {
                console.warn(`No treasury address configured for chain ${chainKey}`);
                continue;
            }

            const handler: ChainHandler = chain.type === 'evm' 
                ? new EVMHandler(chain, chain.rpc.url, treasuryAddress)
                : new SolanaHandler(chain, chain.rpc.url, treasuryAddress);

            handler.on('depositDetected', (event: TransactionEvent) => {
                this.emit('depositDetected', event);
            });

            await handler.startEventListener();
            this.handlers.set(chain.id.toString(), handler);
            
            console.log(`Initialized ${chain.name} handler with treasury ${treasuryAddress}`);
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
        const treasuryAddress = this.treasuryAddresses[token.chain.id.toString()];
        return handler.transfer(treasuryAddress, to, token, amount);
    }

    async shutdown() {
        for (const handler of this.handlers.values()) {
            await handler.stopEventListener();
        }
    }
} 