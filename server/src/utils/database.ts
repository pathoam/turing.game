import mongoose from 'mongoose';
import { Participant } from '../models/participant';
import { chatSession } from '../models/chatSession';
import { Message } from '../models/message';
import { Assistant } from '../models/assistant';
import { v4 as uuidv4 } from 'uuid';
import { initDefaultAssistant } from '../handlers/assistant';

export async function initializeDatabase() {
  try {
    console.log('Initializing database...');

    // Create collections if they don't exist
    const collections = mongoose.connection.collections;
    
    const models = [
      { name: 'participants', model: Participant },
      { name: 'chatsessions', model: chatSession },
      { name: 'messages', model: Message },
      { name: 'assistants', model: Assistant }
    ];

    for (const { name, model } of models) {
      if (!collections[name]) {
        await model.createCollection();
        console.log(`Created collection: ${name}`);
      }
    }

    // Initialize default AI assistant
    await initDefaultAssistant();

    // Create indexes
    await Promise.all([
      Participant.syncIndexes(),
      chatSession.syncIndexes(),
      Message.syncIndexes(),
      Assistant.syncIndexes()
    ]);

    console.log('Database initialization complete!');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}