import { EVMHandler } from '../chainHandler/evmHandler';
import { SolanaHandler } from '../chainHandler/solanaHandler';
import { Chain, Token } from '../utils/balances';

export class ChainManager {
  private handlers: Map<string, EVMHandler | SolanaHandler> = new Map();
  
  constructor(chains: Chain[]) {
    chains.forEach(chain => {
      const chainId = chain.id.toString();
      if (chain.type === 'evm') {
        this.handlers.set(chainId, new EVMHandler(chain, chain.rpc!));
      } else if (chain.type === 'solana') {
        this.handlers.set(chainId, new SolanaHandler(chain, process.env.HELIUS_API_KEY!));
      }
    });
  }

  async getBalance(address: string, token: Token): Promise<number> {
    const chainId = token.chain.id.toString();
    const handler = this.handlers.get(chainId);
    if (!handler) throw new Error(`No handler for chain ${chainId}`);
    return handler.getBalance(address, token);
  }

  async transfer(
    from: string,
    to: string,
    token: Token,
    amount: number
  ) {
    const chainId = token.chain.id.toString();
    const handler = this.handlers.get(chainId);
    if (!handler) throw new Error(`No handler for chain ${chainId}`);
    return handler.transfer(from, to, token, amount);
  }
} 