import { EventEmitter } from 'events';
import { CHAINS, Chain, Token, TokenWithChain } from './chains';
import { EVMHandler } from './evmHandler';
import { SolanaHandler } from './solanaHandler';
import { ChainHandler, TransactionEvent, TransactionResult } from './chainHandler';
import { ArbitrumHandler } from './arbitrumHandler';
import { BaseHandler } from './baseHandler';
import { Server } from 'socket.io';
import { ethers } from 'ethers';
import { Participant } from '../models/participant';
import { TokenAmount } from '../utils/tokenAmount';
import { activeParticipants } from '../utils/activeParticipants';

export class ChainManager extends EventEmitter {
    private static instance: ChainManager;
    private handlers: Map<string, ChainHandler> = new Map();
    private io?: Server;

    private constructor() {
        super();
    }

    public setSocketServer(io: Server) {
        this.io = io;
        this.setupSocketHandlers();
    }

    public static getInstance(): ChainManager {
        if (!ChainManager.instance) {
            ChainManager.instance = new ChainManager();
        }
        return ChainManager.instance;
    }

    async initialize() {
        for (const chain of Object.values(CHAINS)) {
            // Validate required chain parameters
            if (!chain.rpc.url || !chain.treasuryAddress) {
                console.error(`Missing required configuration for chain ${chain.name}`);
                continue;
            }

            const handler: ChainHandler = chain.type === 'evm'
                ? (chain.id === 42161 
                    ? new ArbitrumHandler(chain, chain.rpc.url, chain.treasuryAddress)
                    : chain.id === 8453
                        ? new BaseHandler(chain, chain.rpc.url, chain.treasuryAddress)
                        : new EVMHandler(chain, chain.rpc.url, chain.treasuryAddress))
                : new SolanaHandler(chain, chain.rpc.url, chain.treasuryAddress);

            // Listen for contract events
            if (handler instanceof EVMHandler) {
                handler.on('deposit', (event) => {
                    this.handleDeposit(event);
                });
                
                handler.on('withdrawal', (event) => {
                    this.handleWithdrawal(event);
                });
                
                handler.on('gameResult', (event) => {
                    this.handleGameResult(event);
                });
                
                handler.on('balanceUpdate', (event) => {
                    this.handleBalanceUpdate(event);
                });
            }

            await handler.startEventListener();
            this.handlers.set(chain.id.toString(), handler);
            
            console.log(`Initialized ${chain.name} handler with treasury ${chain.treasuryAddress}`);
        }
    }

    private setupSocketHandlers() {
        if (!this.io) return;

        this.io.on('connection', (socket) => {
            // Just relay events from contract to connected clients
            socket.on('subscribeToUpdates', (address: string) => {
                socket.join(address); // Join room for this address
            });
        });
    }

    // Move withdrawal logic to a separate method
    public async verifyWithdrawal(
        chainId: string,
        user: string, 
        token: Token,  // Use Token type instead of string
        amount: string
    ): Promise<{
        isValid: boolean;
        currentBalance: bigint;
        contractBalance: bigint;
        error?: string;
    }> {
        const handler = this.getHandler(chainId);
        if (!(handler instanceof EVMHandler)) {
            return { 
                isValid: false, 
                currentBalance: 0n,
                contractBalance: 0n,
                error: 'Invalid chain for withdrawal' 
            };
        }

        try {
            const userBalance = await handler.getBalance(user, token);
            const contractBalance = await handler.getContractTokenBalance(token.address);
            const amountBigInt = BigInt(amount);

            return {
                isValid: BigInt(userBalance) >= amountBigInt && contractBalance >= amountBigInt,
                currentBalance: BigInt(userBalance),
                contractBalance,
                error: undefined
            };
        } catch (error) {
            console.error('Error verifying withdrawal:', error);
            return {
                isValid: false,
                currentBalance: 0n,
                contractBalance: 0n,
                error: 'Failed to verify balances'
            };
        }
    }

    // Event handlers
    private handleDeposit(event: any) {
        const { chainId, user, token, amount } = event;
        this.handleChainDeposit(chainId, user, token, amount, event);
        
        // Also emit to websocket
        if (this.io) {
            this.io.to(user).emit('deposit', event);
        }
    }

    private handleWithdrawal(event: any) {
        const { chainId, user, token, amount } = event;
        this.handleChainWithdrawal(chainId, user, token, amount, event);
        
        if (this.io) {
            this.io.to(user).emit('withdrawal', event);
        }
    }

    private handleGameResult(event: any) {
        const { chainId, user, token, gameId, amountChange, gameResultHash } = event;
        this.handleChainGameResult(chainId, user, token, gameId, amountChange, gameResultHash, event);
        
        if (this.io) {
            this.io.to(user).emit('gameResult', event);
        }
    }

    private handleBalanceUpdate(event: any) {
        const { chainId, user, token, newBalance } = event;
        this.handleChainBalanceUpdate(chainId, user, token, newBalance, event);
        
        if (this.io) {
            this.io.to(user).emit('balanceUpdate', event);
        }
    }

    // Chain-specific handlers
    private async handleChainDeposit(chainId: string, user: string, token: string, amount: bigint, event: any) {
        const handler = this.getHandler(chainId);
        if (!handler) {
            console.error(`No handler found for chain ${chainId}`);
            return;
        }

        try {
            let participant = activeParticipants.get(user);
            if (!participant) {
                const dbParticipant = await Participant.findOne({ address: user, role: 'user' });
                if (dbParticipant) {
                    participant = dbParticipant;
                    activeParticipants.set(user, dbParticipant);
                } else {
                    console.warn(`No participant found for address ${user}`);
                    return;
                }
            }

            const tokenAddress = token === 'ETH' ? ethers.ZeroAddress : token;
            const tokenInfo = token === 'ETH' 
                ? handler.chain.tokens.ETH
                : handler.findTokenInChain(tokenAddress);
            
            const decimals = tokenInfo?.decimals || 18;

            const depositAmount = new TokenAmount(amount, decimals);
            await participant.updateBalance(tokenAddress, depositAmount, chainId);

            if (this.io) {
                this.io.to(user).emit('balanceUpdate', {
                    chainId,
                    token: tokenAddress,
                    newBalance: participant.getBalance(tokenAddress)
                });
            }
        } catch (error) {
            console.error(`Error handling deposit on chain ${chainId}:`, error);
        }
    }

    private async handleChainWithdrawal(chainId: string, user: string, token: string, amount: bigint, event: any) {
        const handler = this.getHandler(chainId);
        if (!handler) {
            console.error(`No handler found for chain ${chainId}`);
            return;
        }
        // Same pattern as handleChainDeposit but with negative amount
        // ... rest of withdrawal logic
    }

    private async handleChainGameResult(chainId: string, user: string, token: string, gameId: string, amountChange: bigint, gameResultHash: string, event: any) {
        const handler = this.getHandler(chainId);
        if (!handler) {
            console.error(`No handler found for chain ${chainId}`);
            return;
        }
        // Game result update logic
    }

    private async handleChainBalanceUpdate(chainId: string, user: string, token: string, newBalance: bigint, event: any) {
        const handler = this.getHandler(chainId);
        if (!handler) {
            console.error(`No handler found for chain ${chainId}`);
            return;
        }
        // Balance update logic
    }

    // Methods from old ChainManager
    async getBalance(address: string, token: TokenWithChain): Promise<number> {
        const handler = this.handlers.get(token.chain.id.toString());
        if (!handler) {
            throw new Error(`No handler found for chain ${token.chain.id}`);
        }
        return handler.getBalance(address, token);
    }

    async transfer(
        chainId: string | number,
        to: string,
        token: TokenWithChain,
        amount: number
    ): Promise<TransactionResult> {
        const handler = this.handlers.get(chainId.toString());
        if (!handler) {
            throw new Error(`No handler found for chain ${chainId}`);
        }
        if (!token.chain.treasuryAddress) {
            throw new Error(`No treasury address configured for chain ${chainId}`);
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