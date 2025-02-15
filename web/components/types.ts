export interface Participant {
    id: string;
    address: string;
    role: 'user' | 'assistant';
    status: 'active' | 'inactive';
    alias?: string;
    elo: number;
    gamesPlayed: number;
    wins: number;
    usdcBalance?: number;
    winnings?: number;
  }
  
  export interface Assistant {
    id: string;
    address: string;
    modelName: string;
    apiType: string;
    apiUrl: string;
    systemMsg: string;
    params: {
      temperature?: number;
      max_tokens?: number;
      [key: string]: any;
    };
  }
  
  export interface AssistantResponse {
    participant: Participant;
    assistant: Assistant;
  }
  
  export interface ParticipantsResponse {
    user: Participant;
    assistants: AssistantResponse[];
  }

  export interface Message {
    sessionId: string;
    senderId: string;
    content: string;
    timestamp: Date;
    role: 'user' | 'assistant' | 'system';  // Added role for system messages
  }
  
  export interface ChatSession {
    id: string;
    participants: string[];  // Array of participant IDs
    startTime: Date;
    endTime?: Date;
    status: 'active' | 'completed' | 'abandoned';
    gameType: 'turing';     // Can expand this later for different game types
    winner?: string;        // Participant ID of winner
    winnings?: number;      // Amount won in USDC
  }
  
  
  export interface ChatStartResponse {
    sessionId: string;
    opponent: Participant;  
  }

  export interface GameResult {
    winner: boolean;  // true if this client won
    balances: {
      sol: number;
      usdc: number;
      turing: number;
    };
    opponent: {
      address: string;
      alias: string;
    };
    differences?: {  // Add differences to track winnings/losses
      sol: number;
      usdc: number;
      turing: number;
    };
  }

  export type GameMode = 'casual' | 'ranked' | 'tournament';