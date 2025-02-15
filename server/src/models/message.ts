import mongoose, { Document } from 'mongoose';

export  interface Message extends Document {
  sessionId: string;
  senderId: string;
  content: string;
  timestamp: Date;
  role: 'user' | 'assistant' | 'system';
}

const messageSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  senderId: {type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
});

export const Message = mongoose.model<Message>('Message', messageSchema);