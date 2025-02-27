import { ethers } from 'ethers';
import { ChainHandler, TransactionResult, BalanceResponse, TransactionEvent, TokenPrice } from './chainHandler';
import { Chain, Token, TOKENS } from '../utils/balances';
import { WebSocketProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { Alchemy, Network, AlchemySubscription } from 'alchemy-sdk';
import dotenv from 'dotenv';
import { activeParticipants } from '../utils/activeParticipants';
import { Participant } from '../models/participant';
import { TokenAmount } from '../utils/tokenAmount';

// Import contract ABI and address
import { abi as DepositContractABI } from '../../../evm/artifacts/contracts/turing-game.sol/DepositContract.json';

dotenv.config();

// Standard ERC20 ABI for balance and transfer methods
const ERC20_ABI = [
    'event Transfer(address indexed from, address indexed to, uint256 amount)',
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)'
];

interface AlchemyPriceResponse {
    data: Array<{
        symbol: string;
        prices: Array<{
            currency: string;
            value: string;
            lastUpdatedAt: string;
        }>;
        error: string | null;
    }>;
}

export class EVMHandler extends ChainHandler {
    private wsProvider!: WebSocketProvider;  // Must be initialized
    private provider: ethers.JsonRpcProvider;
    private contracts: Map<string, Contract> = new Map();
    private alchemy: Alchemy;
    private priceCache: Map<string, TokenPrice> = new Map();
    private lastPriceUpdate: number = 0;
    private readonly PRICE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private wallet: ethers.Wallet;
    private depositContract: ethers.Contract;
    private contractAddress: string;

    constructor(chain: Chain, rpcUrl: string, treasuryAddress: string) {
        super(chain, rpcUrl, treasuryAddress);
        
        const isLocalhost = rpcUrl.includes('localhost') || rpcUrl.includes('127.0.0.1');
        this.provider = new ethers.JsonRpcProvider(chain.rpc.url);

        if (isLocalhost) {
            // For local development, use HTTP provider for events
            this.wsProvider = this.provider as unknown as WebSocketProvider;
        } else if (chain.rpc.wsUrl) {
            this.wsProvider = new WebSocketProvider(chain.rpc.wsUrl);
        } else {
            throw new Error(`WebSocket URL required for chain ${chain.name}`);
        }
        
        // Initialize Alchemy SDK
        this.alchemy = new Alchemy({
            apiKey: chain.rpc.apiKey,
            network: this.getAlchemyNetwork(chain.id)
        });
        
        // Initialize wallet with private key
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);
        
        // Set contract address
        this.contractAddress = process.env.DEPOSIT_CONTRACT_ADDRESS || '';
        
        // Initialize contract instance
        this.depositContract = new ethers.Contract(
            this.contractAddress,
            DepositContractABI,
            this.wallet
        );
        
        // Set up event listeners
        this.setupEventListeners();
    }

    protected getAlchemyNetwork(chainId: string | number): Network {
        switch(chainId) {
            case 42161: return Network.ARB_MAINNET;
            case 8453: return Network.BASE_MAINNET;
            default: throw new Error(`Unsupported chain ID: ${chainId}`);
        }
    }

    private decodeAddress(hexTopic: string): string {
        const hex = ethers.dataSlice(hexTopic, 12); // remove leading zeros
        return ethers.getAddress(hex);
    }

    private getTokenSymbol(tokenAddress: string): string {
        if (tokenAddress === this.treasuryAddress) {
            return this.chain.nativeToken;
        }
        
        const token = Object.values(TOKENS).find((t: Token) => 
            t.address.toLowerCase() === tokenAddress.toLowerCase() &&
            t.chain.id === this.chain.id
        );
        
        return token?.symbol || 'UNKNOWN';
    }

    async startEventListener(): Promise<void> {
        this.wsProvider.on('block', (blockNumber) => {
            console.log(`New block on ${this.chain.name}: ${blockNumber}`);
        });

        // Set up token transfer listeners
        this.wsProvider.on({
            address: this.treasuryAddress,
            topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event topic
            ]
        }, (log) => {
            const event: TransactionEvent = {
                chainId: this.getChainId().toString(),
                from: this.decodeAddress(log.topics[1]),
                to: this.decodeAddress(log.topics[2]),
                tokenSymbol: this.getTokenSymbol(log.address),
                amount: Number(ethers.formatUnits(log.data, 18)), // TODO: Get correct decimals
                txHash: log.transactionHash
            };

            if (log.address === this.treasuryAddress) {
                this.emitDeposit(event);
            }
        });
    }

    async stopEventListener(): Promise<void> {
        await this.wsProvider.destroy();
    }

    async getBalance(address: string, token: Token): Promise<number> {
        try {
            // Handle native token (ETH)
            if (token.address === '0x0000000000000000000000000000000000000000') {
                const balance = await this.provider.getBalance(address);
                return Number(ethers.formatUnits(BigInt(balance.toString()), token.decimals));
            }
            
            // Handle ERC20 tokens
            const contract = new ethers.Contract(token.address, ERC20_ABI, this.provider);
            const balance = await contract.balanceOf(address);
            return Number(ethers.formatUnits(balance, token.decimals));
        } catch (error) {
            console.error(`Error getting ${token.symbol} balance:`, error);
            throw error;
        }
    }

    async getBalances(address: string, tokens: Token[]): Promise<BalanceResponse> {
        const balances: BalanceResponse = {};
        await Promise.all(
            tokens.map(async (token) => {
                try {
                    balances[token.address] = await this.getBalance(address, token);
                } catch (error) {
                    console.error(`Failed to get balance for token ${token.symbol}:`, error);
                    balances[token.address] = 0;
                }
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
            // Get the wallet using private key (this would need to be provided securely)
            const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);
            
            // Handle native token transfer
            if (token.address === '0x0000000000000000000000000000000000000000') {
                const tx = await wallet.sendTransaction({
                    to,
                    value: ethers.parseUnits(amount.toString(), token.decimals)
                });
                const receipt = await tx.wait();
                return {
                    success: true,
                    hash: receipt?.hash
                };
            }
            
            // Handle ERC20 transfer
            const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);
            const tx = await contract.transfer(
                to,
                ethers.parseUnits(amount.toString(), token.decimals)
            );
            const receipt = await tx.wait();
            
            return {
                success: true,
                hash: receipt?.hash
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error during transfer'
            };
        }
    }

    // Helper method to estimate gas costs
    async estimateTransferGas(
        from: string,
        to: string,
        token: Token,
        amount: number
    ): Promise<bigint> {
        if (token.address === '0x0000000000000000000000000000000000000000') {
            return await this.provider.estimateGas({
                from,
                to,
                value: ethers.parseUnits(amount.toString(), token.decimals)
            });
        }
        
        const contract = new ethers.Contract(token.address, ERC20_ABI, this.provider);
        return await contract.transfer.estimateGas(
            to,
            ethers.parseUnits(amount.toString(), token.decimals)
        );
    }

    // Helper to get current gas price
    async getGasPrice(): Promise<bigint> {
        return await this.provider.getFeeData().then(data => data.gasPrice ?? 0n);
    }

    async getTokenBalances(address: string, tokens: Token[]): Promise<BalanceResponse> {
        try {
            // Filter for ERC20 tokens only
            const tokenAddresses = tokens
                .filter(t => t.address !== '0x0000000000000000000000000000000000000000')
                .map(t => t.address);

            const response = await this.alchemy.core.getTokenBalances(address, tokenAddresses);
            
            const balances: BalanceResponse = {};
            response.tokenBalances.forEach((balance, i) => {
                const token = tokens[i];
                if (!balance.error && balance.tokenBalance) {
                    balances[token.address] = Number(
                        ethers.formatUnits(BigInt(balance.tokenBalance), token.decimals)
                    );
                } else {
                    balances[token.address] = 0;
                }
            });

            // Add native token balance
            const nativeToken = tokens.find(t => 
                t.address === '0x0000000000000000000000000000000000000000'
            );
            if (nativeToken) {
                const balance = await this.provider.getBalance(address);
                balances[nativeToken.address] = Number(
                    ethers.formatUnits(balance, nativeToken.decimals)
                );
            }

            return balances;
        } catch (error) {
            console.error('Error fetching token balances:', error);
            throw error;
        }
    }

    async getTokenPrices(symbols: string[]): Promise<TokenPrice[]> {
        const now = Date.now();
        if (now - this.lastPriceUpdate > this.PRICE_UPDATE_INTERVAL) {
            try {
                const response = await fetch(
                    `https://api.g.alchemy.com/prices/v1/${this.chain.rpc.apiKey}/tokens/by-symbol?symbols=${symbols.join(',')}`,
                    {
                        method: 'GET',
                        headers: { 'Accept': 'application/json' }
                    }
                );

                const { data } = await response.json() as AlchemyPriceResponse;
                
                data.forEach(token => {
                    if (!token.error && token.prices.length > 0) {
                        const usdPrice = token.prices.find(p => p.currency === 'USD');
                        if (usdPrice) {
                            this.priceCache.set(token.symbol, {
                                symbol: token.symbol,
                                usdPrice: parseFloat(usdPrice.value),
                                lastUpdated: now
                            });
                        }
                    }
                });

                this.lastPriceUpdate = now;
            } catch (error) {
                console.error('Failed to update token prices:', error);
            }
        }

        return symbols.map(symbol => this.priceCache.get(symbol) || {
            symbol,
            usdPrice: 0,
            lastUpdated: 0
        });
    }

    private setupEventListeners() {
        this.depositContract.on('ETHDeposit', (user, amount, event) => {
            console.log(`ETH Deposit on ${this.chain.id}: ${user} deposited ${amount}`);
            this.emit('deposit', {
                chainId: this.chain.id.toString(),
                user,
                token: 'ETH',
                amount,
                event
            });
        });

        this.depositContract.on('TokenDeposit', (user, token, amount, event) => {
            console.log(`Token Deposit on ${this.chain.id}: ${user} deposited ${amount} of ${token}`);
            this.emit('deposit', {
                chainId: this.chain.id.toString(),
                user,
                token,
                amount,
                event
            });
        });

        this.depositContract.on('ETHWithdrawal', (user, amount, event) => {
            this.emit('withdrawal', {
                chainId: this.chain.id.toString(),
                user,
                token: 'ETH',
                amount,
                event
            });
        });

        this.depositContract.on('TokenWithdrawal', (user, token, amount, event) => {
            this.emit('withdrawal', {
                chainId: this.chain.id.toString(),
                user,
                token,
                amount,
                event
            });
        });

        this.depositContract.on('GameResultUpdated', (user, token, gameId, amountChange, gameResultHash, event) => {
            this.emit('gameResult', {
                chainId: this.chain.id.toString(),
                user,
                token,
                gameId,
                amountChange,
                gameResultHash,
                event
            });
        });
    }

    // Event handlers
    private async handleDeposit(user: string, token: string, amount: bigint, event: any) {
        try {
            console.log(`[ContractEvent] deposit: user=${user}, token=${token}, amount=${amount.toString()}`);
            
            const chainId = this.chain.id;
            let tokenAddress = token === 'ETH' ? ethers.ZeroAddress : token;
            let decimals = 18;  // default for ETH

            // Get token decimals if it's an ERC20
            if (token !== 'ETH') {
                const knownToken = Object.values(TOKENS).find(t => 
                    t.address.toLowerCase() === token.toLowerCase() && 
                    t.chain.id === chainId
                );
                decimals = knownToken?.decimals || 18;
            }

            // Create TokenAmount for the deposit
            const depositAmount = new TokenAmount(amount, decimals);

            // Update in-memory participant if exists
            let participant = activeParticipants.get(user);
            
            // If not in memory, fetch from DB
            if (!participant) {
                const dbParticipant = await Participant.findOne({ address: user, role: 'user' });
                if (dbParticipant) {
                    participant = dbParticipant;
                    activeParticipants.set(user, dbParticipant);
                }
            }

            if (!participant) {
                console.warn(`No participant record found for address=${user}`);
                return;
            }

            // Update balance
            await participant.updateBalance(tokenAddress, depositAmount, chainId);
            
            // Emit WebSocket event for UI update
            this.emit('balanceUpdate', {
                user,
                token: tokenAddress,
                newBalance: participant.getBalance(tokenAddress)
            });

        } catch (error) {
            console.error('handleDeposit error:', error);
        }
    }
    
    private async handleWithdrawal(user: string, token: string, amount: bigint, event: any) {
        try {
            console.log(`[ContractEvent] withdrawal: user=${user}, token=${token}, amount=${amount.toString()}`);
            
            const chainId = this.chain.id;
            let tokenAddress = token === 'ETH' ? ethers.ZeroAddress : token;
            let decimals = token === 'ETH' ? 18 : (
                Object.values(TOKENS).find(t => 
                    t.address.toLowerCase() === token.toLowerCase() && 
                    t.chain.id === chainId
                )?.decimals || 18
            );

            // Create negative TokenAmount for withdrawal
            const withdrawAmount = new TokenAmount(amount, decimals);
            const negativeAmount = new TokenAmount(`-${withdrawAmount.toString()}`, decimals);

            // Get participant from memory or DB
            let participant = activeParticipants.get(user) || 
                await Participant.findOne({ address: user, role: 'user' });

            if (!participant) {
                console.warn(`No participant record found for address=${user}`);
                return;
            }

            // Update balance
            await participant.updateBalance(tokenAddress, negativeAmount, chainId);
            
            // Keep in-memory map updated
            activeParticipants.set(user, participant);

            // Emit WebSocket event
            this.emit('balanceUpdate', {
                user,
                token: tokenAddress,
                newBalance: participant.getBalance(tokenAddress)
            });

        } catch (error) {
            console.error('handleWithdrawal error:', error);
        }
    }
    
    private async handleGameResult(
        user: string,
        token: string,
        gameId: string,
        amountChange: bigint,
        gameResultHash: string,
        event: any
    ) {
        try {
            console.log(`[ContractEvent] gameResult: user=${user}, gameId=${gameId}, amountChange=${amountChange.toString()}`);
            
            const chainId = this.chain.id;
            let tokenAddress = token === 'ETH' ? ethers.ZeroAddress : token;
            let decimals = token === 'ETH' ? 18 : (
                Object.values(TOKENS).find(t => 
                    t.address.toLowerCase() === token.toLowerCase() && 
                    t.chain.id === chainId
                )?.decimals || 18
            );

            // Create TokenAmount from amountChange (can be positive or negative)
            const changeAmount = new TokenAmount(amountChange.toString(), decimals);

            // Get participant
            let participant = activeParticipants.get(user) || 
                await Participant.findOne({ address: user, role: 'user' });

            if (!participant) {
                console.warn(`No participant record found for address=${user}`);
                return;
            }

            // Update balance
            await participant.updateBalance(tokenAddress, changeAmount, chainId);
            
            // Update in-memory map
            activeParticipants.set(user, participant);

            // Emit WebSocket event
            this.emit('balanceUpdate', {
                user,
                token: tokenAddress,
                newBalance: participant.getBalance(tokenAddress)
            });

        } catch (error) {
            console.error('handleGameResult error:', error);
        }
    }
    
    private async handleBalanceUpdate(user: string, token: string, newBalance: bigint, event: any) {
        // Update user balance in database
        // Notify user via WebSocket
    }
    
    // Function to sign withdrawal authorization
    public async signWithdrawalAuthorization(
        user: string,
        token: string,
        amount: bigint,
        currentBalance: bigint,
        newBalance: bigint,
        gameResultsHash: string,
        nonce: bigint
    ): Promise<string> {
        // Create the authorization struct exactly as in the contract
        const auth = [amount, currentBalance, newBalance, gameResultsHash, nonce];
        const chainId = await this.provider.getNetwork().then(n => n.chainId);
        
        let encoded;
        if (token === 'ETH') {
            // For ETH withdrawals
            encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                [
                    'string',
                    'uint256',
                    'address',
                    'tuple(uint256,uint256,uint256,bytes32,uint256)',
                    'address'
                ],
                [
                    'withdrawETH',
                    chainId,
                    user,
                    auth,
                    this.contractAddress
                ]
            );
        } else {
            // For token withdrawals
            encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                [
                    'string',
                    'uint256',
                    'address',
                    'address',
                    'tuple(uint256,uint256,uint256,bytes32,uint256)',
                    'address'
                ],
                [
                    'withdrawToken',
                    chainId,
                    user,
                    token, // The token address
                    auth,
                    this.contractAddress
                ]
            );
        }
        
        const messageHash = ethers.keccak256(encoded);
        
        // This is the correct way to match MessageHashUtils.toEthSignedMessageHash()
        return await this.wallet.signMessage(ethers.getBytes(messageHash));
    }
    
    // Function to sign game result update
    public async signGameResult(
        user: string,
        token: string,
        gameId: string,
        newBalance: bigint,
        gameResultHash: string,
        nonce: bigint
    ): Promise<string> {
        const chainId = await this.provider.getNetwork().then(n => n.chainId);
        
        // Match contract's abi.encode format exactly
        const messageHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                [
                    'string',
                    'uint256',
                    'address',
                    'address',
                    'tuple(bytes32,uint256,bytes32)',
                    'uint256',
                    'address'
                ],
                [
                    'updateGame',
                    chainId,
                    user,
                    token === 'ETH' ? ethers.ZeroAddress : token,
                    [gameId, newBalance, gameResultHash],
                    nonce,
                    this.contractAddress
                ]
            )
        );

        // Just sign the hash once - wallet.signMessage handles the Ethereum prefix
        return await this.wallet.signMessage(ethers.getBytes(messageHash));
    }

    public async getContractTokenBalance(tokenAddress: string): Promise<bigint> {
        if (tokenAddress === ethers.ZeroAddress) {
            return await this.provider.getBalance(this.contractAddress);
        }
        return await this.depositContract.getContractTokenBalance(tokenAddress);
    }
}