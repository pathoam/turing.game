import { Chain, Token, getAllTokens } from '../chainHandler/chains';

interface Balance {
    chainId: string | number;
    tokenAddress: string;
    amount: bigint;
    decimals: number;
}

export class Balances {
    private balances: Map<string, Balance>;  // tokenAddress -> Balance
    private updateCallback?: (balance: Balance) => void;

    constructor(initialBalances?: Balance[]) {
        this.balances = new Map();
        if (initialBalances) {
            initialBalances.forEach(balance => {
                this.balances.set(balance.tokenAddress, balance);
            });
        }
    }

    public registerUpdateCallback(callback: (balance: Balance) => void) {
        this.updateCallback = callback;
    }

    public updateBalance(balance: Balance) {
        this.balances.set(balance.tokenAddress, balance);
        if (this.updateCallback) {
            this.updateCallback(balance);
        }
    }

    public getBalance(tokenAddress: string): Balance | undefined {
        return this.balances.get(tokenAddress);
    }

    public getAllBalances(): Map<string, Balance> {
        return new Map(this.balances);
    }
}