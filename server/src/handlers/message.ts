import { Message } from '../models/message';
import { chatSession } from '../models/chatSession';
import { Participant } from '../models/participant';
import { getAssistantById } from './assistant';
import { Assistant } from '../models/assistant'
import axios from 'axios';
import { Server, Socket } from 'socket.io';
import OpenAI from 'openai';

export async function createMessage(
  sessionId: string,
  content: string,
  senderId: string,
  role: 'user' | 'assistant' | 'system'
): Promise<Message> {
  return await Message.create({
    sessionId,
    content,
    senderId,
    timestamp: new Date(),
    role,
  });
}

function calculateTypingDelay(text: string): number {
  // Average human typing speed is about 200 characters per minute
  const CHARS_PER_SECOND = 4;
  
  // Add some randomness to seem more natural
  const variability = 0.2; // 20% variance
  const baseDelay = (text.length / CHARS_PER_SECOND) * 1000;
  const randomFactor = 1 + (Math.random() * variability);
  
  // Ensure minimum and maximum delays
  const delay = Math.min(
      Math.max(baseDelay * randomFactor, 1000), // minimum 1 second
      4000 // maximum 8 seconds
  );
  
  return Math.floor(delay);
}

export async function handleSendMessage(socket: Socket, io: Server, sessionId: string, content: string, senderId: string) {
    try {
      // Save message to database
      const message = await createMessage(sessionId, content, senderId, 'user');
  
      // Broadcast message to all participants in the session
      io.to(sessionId).emit('new_message', message);
  
      // Get session details
      const session = await chatSession.findOne({ sessionId: sessionId });
      if (!session) {
        throw new Error('Session not found');
      }

      // Check if there's an AI participant
      const aiParticipant = session.participants.find(p => p.role === 'assistant');
      if (aiParticipant) {
        // Emit typing indicator immediately

        try {
          // Get AI response with delay to simulate typing
          // await new Promise(resolve => setTimeout(resolve, 500));
          
          // Get and emit AI response
          await handleAIResponse(socket, io, session, sessionId);
          
          // Clear typing indicator
          io.to(sessionId).emit('opponent_typing', false);
        } catch (error) {
          console.error('Error getting AI response:', error);
          io.to(sessionId).emit('opponent_typing', false);
          socket.emit('error', 'Failed to get AI response');
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      socket.emit('error', 'Failed to send message');
    }
}

async function handleAIResponse(
  socket: Socket,
  io: Server,
  session: any,
  sessionId: string
) {
  const assistant = session.participants.find((p: any) => p.role === 'assistant');
  if (!assistant) {
      throw new Error('No assistant found in session');
  }
  try {
      // Wait a bit before showing typing indicator
      await new Promise(resolve => setTimeout(resolve, getInitialDelay()));
      io.to(sessionId).emit('typing', {
          senderId: assistant.id,
          isTyping: true
      });

      // Get the AI response first
      const aiResponse = await getAIResponse(sessionId, assistant.id);
      
      // Calculate and apply delay based on response length
      const delay = calculateTypingDelay(aiResponse);
      await new Promise(resolve => setTimeout(resolve, delay));

      const aiMessage = await createMessage(
          sessionId,
          aiResponse,
          assistant.id,
          'assistant'
      );

      io.to(sessionId).emit('typing', {
          senderId: assistant.id,
          isTyping: false
      });
      io.to(sessionId).emit('new_message', aiMessage);
  } catch (error) {
      console.error('AI response error:', error);
      io.to(sessionId).emit('typing', {
          senderId: assistant.id,
          isTyping: false
      });
      throw error;
  }
}

async function getAIResponse(sessionId: string, assistantId: string): Promise<string> {
  try {
    const assistant = await getAssistantById(assistantId);
    if (!assistant) {
      throw new Error('Assistant not found');
    }

    const chatHistory = await formatChat(sessionId);

    if (assistant.systemMsg) {
      chatHistory.unshift({
        role: 'system',
        content: assistant.systemMsg
      });
    }

    switch (assistant.apiType) {
      case 'openai':
        return await handleOpenAIResponse(assistant, chatHistory);

      case 'custom':
        return await handleCustomResponse(assistant, chatHistory);
      default:
        throw new Error(`Unsupported API type: ${assistant.apiType}`);
    }
  } catch (error) {
    console.error('Error getting AI response:', error);
    throw error;
  }
}

async function handleOpenAIResponse(assistant: any, chatHistory: any[]): Promise<string> {
  try {
    const openai = new OpenAI({
      apiKey: assistant.apiKey,
      baseURL: assistant.apiUrl // Optional, if using a different base URL
    });

    const response = await openai.chat.completions.create({
      model: assistant.modelName,
      messages: chatHistory,
      ...assistant.params
    });

    console.log('OpenAI API Response:', response);

    if (!response.choices[0]?.message?.content) {
      throw new Error('No response content received from OpenAI');
    }

    return response.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw error;
  }
}

async function handleCustomResponse(assistant: any, chatHistory: any[]): Promise<string> {
  const response = await axios.post(
    assistant.apiUrl,
    {
      model: assistant.modelName,
      messages: chatHistory,
      ...assistant.params
    },
    {
      headers: {
        'Authorization': `Bearer ${assistant.apiKey || 'lm-studio'}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data.choices[0].message.content;
}

async function formatChat(sessionId: string) {
  const messages = await Message.find({ sessionId }).sort({ timestamp: 1 });
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}

async function generateAIFirstMessage(
  assistant: Assistant
): Promise<string | null> {
  try {
      const initialMessages = assistant?.initialMsgs || [];
      if (initialMessages.length === 0) {
          return null;
      }

      // Get a random message from the assistant's initial messages
      const message = initialMessages[Math.floor(Math.random() * initialMessages.length)];
      
      // Wait a bit before starting
      await new Promise(resolve => setTimeout(resolve, getInitialDelay()));
      
      // Calculate and wait for the delay based on message length
      const delay = calculateTypingDelay(message);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return message;
      
  } catch (error) {
      console.error('Failed to generate AI first message:', error);
      return null;
  }
}

function getInitialDelay(): number {
  // Random delay between 500ms and 2000ms
  return 250 + Math.random() * 1000;
}
