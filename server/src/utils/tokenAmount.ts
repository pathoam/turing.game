export class TokenAmount {
    private nativeAmount: bigint;
    private decimals: number;

    constructor(amount: string | number | bigint, decimals: number) {
        if (typeof amount === 'string') {
            // Handle string inputs like "5.0" or "5000000"
            if (amount.includes('.')) {
                this.nativeAmount = this.decimalToNative(parseFloat(amount), decimals);
            } else {
                this.nativeAmount = BigInt(amount);
            }
        } else if (typeof amount === 'number') {
            this.nativeAmount = this.decimalToNative(amount, decimals);
        } else {
            this.nativeAmount = amount;
        }
        this.decimals = decimals;
    }

    private decimalToNative(amount: number, decimals: number): bigint {
        return BigInt(Math.floor(amount * 10 ** decimals));
    }

    public toNative(): bigint {
        return this.nativeAmount;
    }

    public toDecimal(): number {
        return Number(this.nativeAmount) / 10 ** this.decimals;
    }

    public toString(): string {
        return this.nativeAmount.toString();
    }

    public toUSD(priceUsd: number): number {
        return this.toDecimal() * priceUsd;
    }

    public static fromUSD(usdAmount: number, priceUsd: number, decimals: number): TokenAmount {
        const decimalAmount = usdAmount / priceUsd;
        return new TokenAmount(decimalAmount, decimals);
    }

    public add(other: TokenAmount): TokenAmount {
        if (this.decimals !== other.decimals) {
            throw new Error('Cannot add tokens with different decimals');
        }
        return new TokenAmount(this.nativeAmount + other.nativeAmount, this.decimals);
    }

    public subtract(other: TokenAmount): TokenAmount {
        if (this.decimals !== other.decimals) {
            throw new Error('Cannot subtract tokens with different decimals');
        }
        return new TokenAmount(this.nativeAmount - other.nativeAmount, this.decimals);
    }

    public isNegative(): boolean {
        return this.nativeAmount < BigInt(0);
    }

    public isZero(): boolean {
        return this.nativeAmount === BigInt(0);
    }

    public getDecimals(): number {
        return this.decimals;
    }
} 