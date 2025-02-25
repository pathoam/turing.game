import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { createAdapter } from '@socket.io/mongo-adapter';
import dotenv from 'dotenv';
import { chatSession } from './models/chatSession';
import { Message } from './models/message';
import axios from 'axios';
import { handleSendMessage } from './handlers/message';
import { initParticipant, updateParticipants, editParticipant } from './handlers/participant';
import { MatchingEngine, GameMode } from './handlers/match';
import { Participant } from './models/participant';
import { Assistant } from './models/assistant';
import { createAssistant, getAssistantById, deleteAssistant } from './handlers/assistant';
import { initializeDatabase } from './utils/database';
import { handleReport } from './handlers/report';


dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI!;
const PORT = parseInt(process.env.PORT || '3001');

const FEE = .1;
// const MODEL = "TheBloke/OpenHermes-2.5-Mistral-7B-16k-GGUF/openhermes-2.5-mistral-7b-16k.Q8_0.gguf";

async function main() {
  // Connect to MongoDB
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');
  await initializeDatabase();

  // Create HTTP server
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST']
    }
  });
  console.log('setup websocket server');

  const matchingEngine = new MatchingEngine(io);
  console.log('started matching engine');

  // Map to store participant ID to socket ID mappings
  const activeSockets = new Map<string, string>();
  async function findSocketByParticipantId(participantId: string) {
    const socketId = activeSockets.get(participantId);
    if (!socketId) return null;
    return io.sockets.sockets.get(socketId);
  }

  // Setup MongoDB adapter for Socket.IO
  const mongoCollection = mongoose.connection.collection('socket.io-adapter-events') as any;
  io.adapter(createAdapter(mongoCollection));

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.onAny((eventName, ...args) => {
      console.log('Received event:', eventName, 'with args:', args);
    });

    socket.emit('connection_established');
    
    socket.on('initialize_participant', async ({ address, role = 'user' }) => {
      console.log('Processing initialize_participant for ', address);
      try {
        const participant = await initParticipant(address, role);
        
        // Store the mapping
        activeSockets.set(participant.id, socket.id);
        
        socket.on('disconnect', () => {
          // Clean up the mapping when socket disconnects
          activeSockets.delete(participant.id);
        });

        socket.emit('participant_initialized', participant);
      } catch (error) {
        console.error('Failed to initialize participant:', error);
        socket.emit('error', 'Failed to initialize participant');
      }
    });

    socket.on('find_match', async ({ participant, gameMode }: {
      participant: Participant;
      gameMode: GameMode;
    }) => {
      console.log('Finding match:', {
        participantId: participant.id,
        gameMode,
        stake: participant.currentStake?.amountUsd || 0
      });
    
      try {
        await matchingEngine.tryMatch(socket, participant, gameMode);
        // If no match is found, the participant is added to the pool
        // We should let the client know they're in queue
        socket.emit('matching_status', { status: 'queued', gameMode });
      } catch (error) {
        console.error('Match finding error:', error);
        socket.emit('error', error instanceof Error ? error.message : 'Failed to find match');
        // Also reset matching status on error
        socket.emit('matching_status', { status: 'failed' });
      }
    });

    socket.on('delete_assistant', async ({ address, assistantId }) => {
      console.log('Received delete_assistant request:', { address, assistantId });
      try {
        const success = await deleteAssistant(address, assistantId);
        socket.emit('assistant_deleted', { success });
      } catch (error) {
        console.error('Error deleting assistant:', error);
        socket.emit('assistant_deleted', { 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to delete assistant' 
        });
      }
    });

    socket.on('edit_participant', async ({ participant, assistant }) => {
      console.log('Received edit_participant request:', { participant, assistant });
      try {
        const result = await editParticipant(participant, assistant);
        socket.emit('participant_updated', { 
          success: true,
          data: result
        });
      } catch (error) {
        console.error('Error updating participant:', error);
        socket.emit('participant_updated', { 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to update participant' 
        });
      }
    });

    socket.on('join_chat', async (sessionId: string) => {
      try {
        const session = await chatSession.findOne({ sessionId });
        if (!session) {
          socket.emit('error', 'Chat session not found');
          return;
        }

        socket.join(sessionId);
        const messages = await Message.find({ sessionId }).sort({ timestamp: 1 });
        socket.emit('chat_history', { session, messages });
      } catch (error) {
        console.error('Failed to join chat:', error);
        socket.emit('error', 'Failed to join chat session');
      }
    });

    socket.on('typing', ({ sessionId, senderId, isTyping }) => {
      // console.log('Typing event received:', { sessionId, senderId, isTyping });
      // Broadcast typing status to all participants in the session
      io.to(sessionId).emit('typing', { senderId, isTyping });
  });

    socket.on('getBalances', async ({ participantId }) => {
      try {
          const participant = await Participant.findOne({ id: participantId });
          if (!participant) {
              socket.emit('error', 'Participant not found');
              return;
          }
  
          socket.emit('balanceUpdate', {
              balances: participant.balances,
              winnings: participant.winnings
          });
      } catch (error) {
          console.error('Failed to get balances:', error);
          socket.emit('error', 'Failed to get balance information');
      }
    });

    socket.on('report', async(params) => {
      await handleReport(socket, io, params);
     });

    socket.on('send_message', async ({ sessionId, content, senderId }) => {
      try {
        await handleSendMessage(socket, io, sessionId, content, senderId);
      } catch (error) {
        console.error('Message handling error:', error);
        socket.emit('error', error instanceof Error ? error.message : 'Failed to send message');
      }
    });


    interface AssistantResponse {
      participant: Participant;
      assistant: Assistant;  
    }
    
    interface ParticipantsResponse {
      user: Participant;
      assistants: AssistantResponse[];
    }
    
    socket.on('fetch_participants', async ({ address }) => {
      console.log('Server received fetch_participants request for:', address);
      try {
        // Get the user participant
        const userDoc = await Participant.findOne({ address, role: 'user' });
        if (!userDoc) {
          socket.emit('error', 'User not found');
          return;
        }

        // Convert Mongoose document to plain object
        const user = userDoc.toObject();

        // Get all assistant participants for this user
        const assistantParticipantDocs = await Participant.find({ 
          address, 
          role: 'assistant' 
        });

        // Get the corresponding assistant configs and convert to plain objects
        const assistantResponses = await Promise.all(
          assistantParticipantDocs.map(async (participantDoc) => {
            const assistantDoc = await Assistant.findOne({ id: participantDoc.id });
            if (!assistantDoc) return null;

            return {
              participant: participantDoc.toObject(),
              assistant: assistantDoc.toObject()
            };
          })
        );

        const response: ParticipantsResponse = {
          user,
          assistants: assistantResponses.filter((r) => r !== null) as AssistantResponse[]
        };

        socket.emit('participants_data', response);
        console.log(response);
      } catch (error) {
        console.error('Error fetching participants:', error);
        socket.emit('error', 'Failed to fetch participants data');
      }
    });
    
    socket.on('fetch_user', async ({ id, address }) => {
      console.log('Server received fetch_user request:', { id, address });
      try {
        let participant;
    
        if (id) {
          participant = await Participant.findOne({ id, role: 'user' });
        } else if (address) {
          participant = await Participant.findOne({ address, role: 'user' });
        } else {
          socket.emit('error', 'No id or address provided');
          return;
        }
    
        if (!participant) {
          socket.emit('error', 'User not found');
          return;
        }    
        socket.emit('user_data', participant);
      } catch (error) {
        console.error('Error fetching user:', error);
        socket.emit('error', 'Failed to fetch user data');
      }
    });
    
    socket.on('fetch_assistant', async ({ id, address }) => {
      console.log('Server received fetch_assistant request:', { id, address });
      try {
        let participant, assistant;
    
        if (id) {
          // Search by ID
          participant = await Participant.findOne({ id, role: 'assistant' });
          assistant = await Assistant.findOne({ id });
        } else if (address) {
          // Search by address
          participant = await Participant.findOne({ address, role: 'assistant' });
          if (participant) {
            assistant = await Assistant.findOne({ id: participant.id });
          }
        } else {
          socket.emit('error', 'No id or address provided');
          return;
        }
    
        if (!participant || !assistant) {
          socket.emit('error', 'Assistant not found');
          return;
        }   
        const response: AssistantResponse = {
          participant,
          assistant,
        };
        console.log(response);

        socket.emit('assistant_data', response);
      } catch (error) {
        console.error('Error fetching assistant:', error);
        socket.emit('error', 'Failed to fetch assistant data');
      }
    });

    socket.on('create_assistant', async ({ address, alias, assistantData }) => {
      console.log('Received create_assistant request:', { address, alias, assistantData });
      try {
        const { assistant, participant } = await createAssistant(address, alias, assistantData);
        console.log('Created assistant:', assistant);
        console.log('Created participant:', participant);
        
        // Make sure we're sending both objects in the response
        socket.emit('assistant_created', { 
          success: true,
          data: {  // This was missing!
            assistant,
            participant
          }
        });
    
      } catch (error) {
        console.error('Error creating assistant:', error);
        socket.emit('assistant_created', { 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to create assistant' 
        });
      }
    });

      socket.on('fetch_rankings', async () => {
        try {
          // Fetch top users
          const topUsers = await Participant.find({ role: 'user' })
            .sort({ elo: -1 })
            .limit(10)
            .select('id alias elo gamesPlayed wins');
      
          // Fetch top AI participants
          const topAIParticipants = await Participant.find({ role: 'assistant' })
            .sort({ elo: -1 })
            .limit(10)
            .select('id alias elo gamesPlayed wins');
      
          // Get corresponding assistant configs
          const topAgents = await Promise.all(
            topAIParticipants.map(async (participant) => {
              const assistant = await Assistant.findOne({ id: participant.id })
                .select('id modelName apiType');
              
              return {
                id: participant.id,
                alias: participant.alias,
                modelName: assistant?.modelName,
                elo: participant.elo,
                gamesPlayed: participant.gamesPlayed,
                wins: participant.wins
              };
            })
          );
      
          socket.emit('ranking_data', {
            users: topUsers,
            agents: topAgents
          });
        } catch (error) {
          console.error('Error fetching rankings:', error);
          socket.emit('error', 'Failed to fetch rankings');
        }
      });

    socket.on('matchmaking_started', async ({ participant, gameMode }) => {
      console.log('Received matchmaking_started event:', {
        participantId: participant.id,
        gameMode,
        stake: participant.currentStake?.amountUsd || 0
      });
      try {
        await matchingEngine.tryMatch(socket, participant, gameMode);
        socket.emit('matchmaking_started', {
          participantId: participant.id,
          gameMode,
          stake: participant.currentStake?.amountUsd || 0
        });
      } catch (error) {
        console.error('Matchmaking error:', error);
        socket.emit('error', error instanceof Error ? error.message : 'Failed to start matchmaking');
      }
    });
    });
    
    io.listen(PORT);
    console.log(`WebSocket server is listening on port ${PORT}`);
  }

async function getAIResponse(sessionId: string, assistantId: string) {
  try {
    // Get the assistant configuration
    const assistant = await getAssistantById(assistantId);
    if (!assistant) {
      throw new Error('Assistant not found');
    }

    // Get chat history
    const chatHistory = await formatChat(sessionId);

    // Add system message if it exists
    if (assistant.systemMsg) {
      chatHistory.unshift({
        role: 'system',
        content: assistant.systemMsg
      });
    }

    // Make API request based on assistant configuration
    let response;
    switch (assistant.apiType) {
      case 'openai':
        response = await axios.post(assistant.apiUrl, {
          model: assistant.modelName,
          messages: chatHistory,
          ...assistant.params // Spread additional parameters
        }, {
          headers: {
            'Authorization': `Bearer ${assistant.apiKey}`,
            'Content-Type': 'application/json'
          }
        });
        return response.data.choices[0].message.content;

      // case 'anthropic':
      //   const anthropic = new Anthropic({
      //     apiKey: assistant.apiKey
      //   });
      //   const messages = chatHistory.map(msg => ({
      //     role: msg.role === 'assistant' ? 'assistant' : 'user',
      //     content: msg.content
      //   }));
      //   response = await anthropic.messages.create({
      //     model: assistant.modelName,
      //     messages: messages,
      //     system: assistant.systemMsg,
      //     ...assistant.params
      //   });
      //   return response.content[0].text;

      case 'custom':
        // For custom endpoints (like local LM Studio)
        response = await axios.post(assistant.apiUrl, {
          model: assistant.modelName,
          messages: chatHistory,
          ...assistant.params
        }, {
          headers: {
            'Authorization': `Bearer ${assistant.apiKey || 'lm-studio'}`,
            'Content-Type': 'application/json'
          }
        });
        return response.data.choices[0].message.content;

      default:
        throw new Error(`Unsupported API type: ${assistant.apiType}`);
    }
  } catch (error) {
    console.error('Error getting AI response:', error);
    throw error;
  }
}

async function formatChat(sessionId: string) {
  // Retrieve messages for the session from the database
  const messages = await Message.find({ sessionId }).sort({ timestamp: 1 });

  // Format the messages for the API
  const chatHistory = messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  return chatHistory;
}

main().catch(err => {
    console.log('Fatal server error:', err);
    process.exit(1);
  });