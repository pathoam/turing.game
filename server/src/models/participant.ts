import mongoose, { Document, Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { TokenAmount } from '../utils/tokenAmount';

export type Currency = 'sol' | 'usdc' | 'turing';

export interface Balances {
  sol: number;
  usdc: number;
  turing: number;
}

export interface GameOutcome {
  winner: Participant;
  loser: Participant;
  sessionId: string;
}

export interface TokenBalance {
    tokenAddress: string;
    chainId: string | number;
    amount: string;  // Store as string to handle large numbers safely
    decimals: number;
}

export interface StakeInfo {
    amountUsd: number;      // USD value at stake time
    tokenAddress: string;   // Token contract address
    chainId: string | number;
    tokenAmount: string;    // Native token amount (e.g. "5000000" for 5 USDC)
    decimals: number;       // Token decimals for conversion
    priceUsd?: number;      // Optional: price at stake time
}

export interface VerificationStatus {
  verified: boolean;
  score: number;  // For hCaptcha/reCAPTCHA score
  lastVerified: Date;
  method: 'hcaptcha' | 'recaptcha' | 'turnstile';
}

export interface Participant extends Document {
  id: string;           // UUID primary key
  address: string;      // Solana wallet address
  role: 'user' | 'assistant';
  status: 'active' | 'inactive';
  alias?: string;
  elo: number;
  gamesPlayed: number;
  wins: number;
  balances: Balances;
  currentStake: StakeInfo;  // Current game stake info
  winnings?: number;         // Lifetime winnings in USD
  verification?: VerificationStatus;
  updateBalance(tokenAddress: string, amount: TokenAmount, chainId: string | number): Promise<Participant>;
  getBalance(tokenAddress: string): TokenBalance | undefined;
  setStake(stake: StakeInfo): Promise<Participant>;
  clearStake(): Promise<Participant>;
}

const stakeInfoSchema = new Schema<StakeInfo>({
  amountUsd: { type: Number, required: true },
  tokenAddress: { type: String, required: true },
  chainId: { type: Schema.Types.Mixed, required: true },
  tokenAmount: { type: String, required: true },
  decimals: { type: Number, required: true },
  priceUsd: { type: Number }
}, { _id: false });

const balancesSchema = new Schema<Balances>({
  sol: { type: Number, default: 0 },
  usdc: { type: Number, default: 0 },
  turing: { type: Number, default: 0 }
}, { _id: false });

const verificationSchema = new Schema<VerificationStatus>({
  verified: { type: Boolean, default: false },
  score: { type: Number, min: 0, max: 1 },
  lastVerified: { type: Date },
  method: { type: String, enum: ['hcaptcha', 'recaptcha', 'turnstile'] }
}, { _id: false });

const participantSchema = new Schema<Participant>({
  id: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true, 
    default: () => uuidv4() 
  },
  address: { type: String, required: true },
  role: { 
    type: String, 
    required: true, 
    enum: ['user', 'assistant'] 
  },
  status: { 
    type: String, 
    required: true, 
    enum: ['active', 'inactive'], 
    default: 'active' 
  },
  alias: { type: String },
  elo: { type: Number, default: 1000 },
  gamesPlayed: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  balances: { 
    type: Map,
    of: {
      tokenAddress: String,
      chainId: Schema.Types.Mixed,
      amount: String,
      decimals: Number
    }
  },
  currentStake: { 
    amountUsd: Number,
    tokenAddress: String,
    chainId: Schema.Types.Mixed,
    tokenAmount: String,
    decimals: Number,
    priceUsd: Number
  },
  winnings: { type: Number, default: 0 },
  verification: { type: verificationSchema }
});

// Add non-unique index for querying by address
participantSchema.index({ address: 1 });

// Add compound index for user role (only one user per address)
participantSchema.index(
  { address: 1, role: 1 }, 
  { 
    unique: true, 
    partialFilterExpression: { role: 'user' }  // Only enforce uniqueness for users
  }
);

// Helper methods for balance operations
participantSchema.methods.updateBalance = function(
    tokenAddress: string,
    amount: TokenAmount,
    chainId: string | number
) {
    const currentBalance = this.balances.get(tokenAddress) || {
        tokenAddress,
        chainId,
        amount: "0",
        decimals: amount.decimals
    };
    
    const currentAmount = new TokenAmount(currentBalance.amount, currentBalance.decimals);
    const newAmount = currentAmount.add(amount);
    
    if (newAmount.isNegative()) {
        throw new Error('Insufficient balance');
    }
    
    this.balances.set(tokenAddress, {
        ...currentBalance,
        amount: newAmount.toString()
    });
    
    return this.save();
};

participantSchema.methods.getBalance = function(tokenAddress: string) {
    return this.balances.get(tokenAddress);
};

participantSchema.methods.setStake = function(stake: StakeInfo) {
    this.currentStake = stake;
    return this.save();
};

participantSchema.methods.clearStake = function() {
  this.currentStake = undefined;
  return this.save();
};

// Type for the model with static methods
interface ParticipantModel extends mongoose.Model<Participant> {
  // Add any static methods here if needed
}

export const Participant = mongoose.model<Participant, ParticipantModel>(
  'Participant', 
  participantSchema
);