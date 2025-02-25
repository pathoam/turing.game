import { Network } from 'alchemy-sdk';
import { EVMHandler } from './evmHandler';
import { Chain } from '../utils/balances';

export class ArbitrumHandler extends EVMHandler {
    constructor(chain: Chain, rpcUrl: string, treasuryAddress: string) {
        super(chain, rpcUrl, treasuryAddress);
    }

    protected getAlchemyNetwork(): Network {
        return Network.ARB_MAINNET;
    }

    // Override gas estimation if needed
    // async estimateTransferGas(...) { }
} 