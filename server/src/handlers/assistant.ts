import { Assistant } from '../models/assistant';
import { Types } from 'mongoose';
import {Participant} from '../models/participant';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';



/**
 * Creates a new assistant and its corresponding participant record
 * @param assistantData - The assistant configuration data
 * @returns The created assistant document and participant document
 */
export async function createAssistant(address: string, alias: string, assistantData: {
    modelName: string;
    apiType: string;
    apiUrl: string;
    apiKey?: string;
    systemMsg: string;
    params?: {[key: string]: any};
  }): Promise<{assistant: Assistant, participant: Participant}> {
    try {
      // First create the participant to get the UUID
      const participantId = uuidv4();
      const participant = new Participant({
        id: participantId,
        address: address,
        role: 'assistant',
        status: 'inactive',
        alias: alias,
        elo: 1000,
        gamesPlayed: 0,
        wins: 0
      });
      await participant.save();
  
      // Create assistant with same UUID
      const assistant = new Assistant({
        id: participantId,  // Use same UUID as participant
        address: address,
        modelName: assistantData.modelName,
        apiType: assistantData.apiType,
        apiUrl: assistantData.apiUrl,
        apiKey: assistantData.apiKey,
        systemMsg: assistantData.systemMsg,
        params: assistantData.params || {},
        initialMsgs: [],
      });
      await assistant.save();
      await sampleFirstMessages(assistant);

  
      return { assistant, participant };
    } catch (error) {
      console.error('Failed to create assistant:', error);
      throw error;
    }
  }

/**
 * Updates an existing assistant's configuration
 * @param assistantId - The Solana address of the assistant
 * @param updates - Partial assistant data to update
 * @returns The updated assistant document
 */
export async function updateAssistant(
  assistantId: string,
  updates: Partial<Omit<Assistant, 'id' | '_id'>>
): Promise<Assistant | null> {
  try {
    // Validate the assistant exists
    const assistant = await Assistant.findOne({ id: assistantId });
    if (!assistant) {
      throw new Error(`Assistant ${assistantId} not found`);
    }

    // Don't allow id modification
    if ('id' in updates) {
      delete updates.id;
    }

    // Update and return the new document
    const updatedAssistant = await Assistant.findOneAndUpdate(
      { id: assistantId },
      { $set: updates },
      { new: true, runValidators: true }
    );

    return updatedAssistant;
  } catch (error) {
    console.error('Failed to update assistant:', error);
    throw error;
  }
}

/**
 * Removes an assistant from the system
 * @param assistantId - The Solana address of the assistant to remove
 * @returns boolean indicating success
 */
export async function deleteAssistant(
    address: string, 
    assistantId: string
  ): Promise<boolean> {
    try {
      // Verify ownership
      const participant = await Participant.findOne({ 
        id: assistantId, 
        address, 
        role: 'assistant' 
      });
  
      if (!participant) {
        throw new Error('Assistant not found or unauthorized');
      }
  
      // Delete both records
      const [participantResult, assistantResult] = await Promise.all([
        Participant.deleteOne({ id: assistantId }),
        Assistant.deleteOne({ id: assistantId })
      ]);
  
      return participantResult.deletedCount === 1 && assistantResult.deletedCount === 1;
    } catch (error) {
      console.error('Failed to delete assistant:', error);
      throw error;
    }
  }

/**
 * Retrieves an assistant by ID
 * @param assistantId - The Solana address of the assistant
 * @returns The assistant document or null if not found
 */
export async function getAssistantById(assistantId: string): Promise<Assistant | null> {
  try {
    return await Assistant.findOne({ id: assistantId });
  } catch (error) {
    console.error('Failed to get assistant:', error);
    throw error;
  }
}

/**
 * Retrieves an assistant by name (alias)
 * @param name - The exact name/alias of the assistant to search for
 * @returns The assistant document or null if not found
 */
export async function getAssistantByName(name: string): Promise<Assistant | null> {
  try {
    const participant = await Participant.findOne({ 
      role: 'assistant',
      alias: name // Exact match on alias
    });

    if (!participant) {
      return null;
    }

    return await Assistant.findOne({ id: participant.id });
  } catch (error) {
    console.error('Failed to get assistant by name:', error);
    throw error;
  }
}


/**
 * Lists all assistants in the system
 * @returns Array of assistant documents
 */
export async function listAssistants(): Promise<Assistant[]> {
  try {
    return await Assistant.find({});
  } catch (error) {
    console.error('Failed to list assistants:', error);
    throw error;
  }
}

async function sampleFirstMessages(assistant: Assistant): Promise<string[]> {
  try {
    const prompts = [
      "hey how's it going?",
      "what's up?",
      "hi there!",
      "hello :)",
      "hey! how are you today?"
    ];

    const messages = await Promise.all(prompts.map(async prompt => {
      const response = await axios.post(
        assistant.apiUrl,
        {
          model: assistant.modelName,
          messages: [
            { role: 'system', content: assistant.systemMsg },
            { role: 'user', content: prompt }
          ],
          ...assistant.params
        },
        {
          headers: {
            'Authorization': `Bearer ${assistant.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data.choices[0].message.content;
    }));

    return messages;
  } catch (error) {
    console.error('Error sampling first messages:', error);
    return [
      "Hey there!",
      "Hi, how are you?",
      "Hello! Nice to meet you",
      "Hey! How's your day going?",
      "Hi :) what's up?"
    ];
  }
}

export async function initDefaultAssistant(): Promise<void> {
  try {
    const assistantCount = await Participant.countDocuments({ role: 'assistant' });
    
    if (assistantCount === 0) {
      console.log('No AI participants found. Creating default Lambda AI participant...');
      const assistantId = uuidv4();
      
      // Create assistant config first
      const assistant = await Assistant.create({
        id: assistantId,
        address: 'lambda-ai',
        modelName: process.env.DEFAULT_AI_NAME,
        apiType: 'custom',
        apiUrl: process.env.LAMBDA_API_URL,
        apiKey: process.env.LAMBDA_API_KEY,
        systemMsg: process.env.DEFAULT_AI_SYSPRIMPT,
        params: {
          temperature: 0.7,
          max_tokens: 150
        }
      });

      // Sample some initial messages
      const initialMsgs = await sampleFirstMessages(assistant);
      assistant.initialMsgs = initialMsgs;
      await assistant.save();

      // Create participant
      await Participant.create({
        id: assistantId,
        address: 'lambda-ai',
        role: 'assistant',
        status: 'active',
        alias: process.env.DEFAULT_AI_NAME,
        elo: 1000,
        gamesPlayed: 0,
        wins: 0
      });

      console.log('Created default Lambda AI participant:', assistantId);
    } else {
      console.log(`Found ${assistantCount} existing AI participants`);
    }
  } catch (error) {
    console.error('Failed to initialize default assistant:', error);
    throw error;
  }
}