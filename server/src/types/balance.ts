export interface Balance {
  amount: string;  // BigInt as string
  decimals: number;
  symbol: string;
  chainName: string;
  chainId: string | number;
}

export interface ParticipantBalances {
  role: 'user' | 'assistant';
  participantId: string;
  balances: {
    [tokenAddress: string]: Balance;
  };
}

export type BalanceResponse = ParticipantBalances[]; 