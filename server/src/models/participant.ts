import mongoose, { Document, Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

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

export interface StakeInfo {
  amount: number;       // Amount in USD
  currency: Currency;   // Currency used for stake
  tokenAmount: number;  // Actual amount of tokens based on price
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
}

const stakeInfoSchema = new Schema<StakeInfo>({
  amount: { type: Number, required: true },
  currency: { 
    type: String, 
    required: true, 
    enum: ['sol', 'usdc', 'turing'] 
  },
  tokenAmount: { type: Number, required: true }
}, { _id: false });

const balancesSchema = new Schema<Balances>({
  sol: { type: Number, default: 0 },
  usdc: { type: Number, default: 0 },
  turing: { type: Number, default: 0 }
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
    type: balancesSchema, 
    default: () => ({
      sol: 0,
      usdc: 0,
      turing: 0
    })
  },
  currentStake: { 
    type: stakeInfoSchema, 
    required: true,
    default: () => ({
      amount: 0,
      currency: 'usdc',
      tokenAmount: 0
    })
  },  winnings: { type: Number, default: 0 }
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
  currency: Currency,
  amount: number
) {
  this.balances[currency] += amount;
  return this.save();
};

participantSchema.methods.getBalance = function(
  currency: Currency
) {
  return this.balances[currency];
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