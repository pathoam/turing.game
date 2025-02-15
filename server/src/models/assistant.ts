import mongoose, { Document, Schema } from 'mongoose';

export interface Assistant extends Document {
  id: string;  // This will match the participant's UUID
  address: string;
  modelName: string;
  apiType: string;
  apiUrl: string; 
  apiKey?: string;
  systemMsg: string;
  params: {[key: string]: any};
  initialMsgs: string[];
}

const assistantSchema = new Schema<Assistant>({
  id: { type: String, required: true, unique: true }, 
  address: { type: String, required: true},
  modelName: { type: String, required: true },
  apiType: { type: String, required: true },
  apiUrl: { type: String, required: true },
  apiKey: { type: String },
  systemMsg: { type: String, required: true },
  params: { type: Schema.Types.Mixed, default: {} }, 
  initialMsgs: { type: [String], default: [] }
});

export const Assistant = mongoose.model<Assistant>('Assistant', assistantSchema);