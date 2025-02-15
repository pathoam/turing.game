export interface Participant {
    id: string;
    address: string;
    status: 'active' | 'inactive';
    role: 'user' | 'assistant';
    alias?: string;
    usdcBalance?: number;
    elo?: number;
    gamesPlayed?: number;
    wins?: number;
    winnings?: number;
  }