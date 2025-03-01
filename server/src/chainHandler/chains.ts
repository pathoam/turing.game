export interface Token {
    symbol: string;
    address: string;
    decimals: number;
}

// For when we need a token with chain info
export interface TokenWithChain extends Token {
    chain: Chain;
}

// Helper to attach chain info to a token
export function attachChainToToken(token: Token, chain: Chain): TokenWithChain {
    return { ...token, chain };
}

export interface Chain {
    id: number | string;
    name: string;
    type: 'evm' | 'solana';
    nativeToken: string;
    treasuryAddress: string | undefined;
    rpc: {
        url: string;        // Required
        wsUrl: string;      // Required for EVMHandler
        apiKey: string;     // Required for Alchemy/Helius
    };
    tokens: Record<string, Token>;
}

// Example chain configurations
export const CHAINS: Record<string, Chain> = {
    ARBITRUM: {
        id: 42161,
        name: 'Arbitrum',
        type: 'evm' as const,
        nativeToken: 'ETH',
        treasuryAddress: process.env.ARBITRUM_TREASURY_ADDRESS,
        rpc: {
            url: process.env.ALCHEMY_ARBITRUM_URL || '',
            wsUrl: process.env.ALCHEMY_ARBITRUM_WS_URL || '',
            apiKey: process.env.ALCHEMY_API_KEY || ''
        },
        tokens: {
            ETH: {
                symbol: 'ETH',
                address: '0x0000000000000000000000000000000000000000',
                decimals: 18
            },
            USDC: {
                symbol: 'USDC',
                address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
                decimals: 6
            }
        }
    },
    BASE: {
        id: 8453,
        name: 'Base',
        type: 'evm' as const,
        nativeToken: 'ETH',
        treasuryAddress: process.env.BASE_TREASURY_ADDRESS,
        rpc: {
            url: process.env.ALCHEMY_BASE_URL || '',
            wsUrl: process.env.ALCHEMY_BASE_WS_URL || '',
            apiKey: process.env.ALCHEMY_API_KEY || ''
        },
        tokens: {
            ETH: {
                symbol: 'ETH',
                address: '0x0000000000000000000000000000000000000000',
                decimals: 18
            },
            USDC: {
                symbol: 'USDC',
                address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                decimals: 6
            }
        }
    },
};

// Helper to get all tokens across all chains
export function getAllTokens(): Record<string, Token & { chain: Chain }> {
    const allTokens: Record<string, Token & { chain: Chain }> = {};
    
    Object.entries(CHAINS).forEach(([chainName, chain]) => {
        Object.entries(chain.tokens).forEach(([tokenKey, token]) => {
            const fullKey = `${chainName}_${token.symbol}`;
            allTokens[fullKey] = { ...token, chain };
        });
    });
    
    return allTokens;
}