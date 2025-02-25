import { Document, Schema, model } from 'mongoose';

export interface UserTransaction extends Document {
  userId: string;         // The participant.id
  chainId: string;        // e.g. '1', '4sGjMW1sUnH...', etc
  tokenSymbol: string;    // e.g. 'USDC'
  direction: 'deposit' | 'withdraw';
  amount: number;         // in decimal
  txHash?: string;        // On-chain transaction
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: Date;
  confirmedAt?: Date;
}

const userTransactionSchema = new Schema<UserTransaction>({
  userId: { type: String, required: true, index: true },
  chainId: { type: String, required: true },
  tokenSymbol: { type: String, required: true },
  direction: { type: String, enum: ['deposit', 'withdraw'], required: true },
  amount: { type: Number, required: true },
  txHash: { type: String },
  status: { 
    type: String, 
    enum: ['pending', 'confirmed', 'failed'], 
    default: 'pending',
    index: true 
  },
  createdAt: { type: Date, default: Date.now },
  confirmedAt: { type: Date }
});

userTransactionSchema.index({ userId: 1, status: 1 });
userTransactionSchema.index({ txHash: 1 }, { unique: true, sparse: true });

export const UserTransaction = model<UserTransaction>('UserTransaction', userTransactionSchema); 