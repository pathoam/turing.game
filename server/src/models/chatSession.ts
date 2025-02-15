import mongoose, { Schema, Document } from 'mongoose';
import { Participant, StakeInfo } from './participant';

export interface ChatSession extends Document {
  sessionId: string;
  participants: [Participant];
  createdAt: Date;
  lastActivity: Date;
  status: 'active' | 'ended';
  winner?: string;
  assistantCount: number;  // Virtual field
}

const chatSessionSchema = new Schema({
  sessionId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  participants: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Participant',
    required: true 
  }],
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  lastActivity: { 
    type: Date, 
    default: Date.now 
  },
  status: { 
    type: String, 
    enum: ['active', 'ended'], 
    default: 'active' 
  },
  winner: { 
    type: String, 
    required: false 
  },
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Rest of the code remains the same...

chatSessionSchema.virtual('assistantCount').get(function() {
  if (!this.populated('participants')) {
    console.warn('Accessing assistantCount on unpopulated participants');
    return 0;
  }
  return this.participants.filter((p: any) => p.role === 'assistant').length;
});
// Add a pre-find middleware to always populate participants
chatSessionSchema.pre('find', function() {
  this.populate('participants');
});

chatSessionSchema.pre('findOne', function() {
  this.populate('participants');
});

export const chatSession = mongoose.model<ChatSession>('ChatSession', chatSessionSchema);