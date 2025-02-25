import { Participant, GameOutcome, StakeInfo, Currency } from '../models/participant';
import { Assistant } from '../models/assistant'
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { calculateEloChange } from '../utils/elo';
import { TokenAmount } from '../utils/tokenAmount';

export async function initParticipant(address: string, role: 'user' | 'assistant' = 'user') {
    try {
        let participant = await Participant.findOne({ address, role });

        if (!participant) {
            participant = await Participant.create({
                id: uuidv4(),
                address,
                role,
                status: 'active',
                elo: 1000,
                gamesPlayed: 0,
                wins: 0,
                winnings: 0,
                balances: new Map(), // Start with empty balances
                currentStake: null
            });
        }

        return participant;
    } catch (error) {
        console.error('Failed to initialize participant:', error);
        throw error;
    }
}

export async function editParticipant(
  participant: Participant,
  assistant?: Assistant
): Promise<{ participant: Participant; assistant?: Assistant }> {
  try {
    // Verify ownership
    const existingParticipant = await Participant.findOne({ 
      id: participant.id,
      address: participant.address
    });

    if (!existingParticipant) {
      throw new Error('Participant not found or unauthorized');
    }

    // Update participant
    const updatedParticipant = await Participant.findOneAndUpdate(
      { id: participant.id },
      { $set: participant },
      { new: true }
    );

    if (!updatedParticipant) {
      throw new Error('Failed to update participant');
    }

    // Update assistant if provided
    let updatedAssistant;
    if (assistant) {
      updatedAssistant = await Assistant.findOneAndUpdate(
        { id: participant.id },
        { 
          $set: {
            ...assistant,
            id: participant.id
          }
        },
        { new: true }
      );

      if (!updatedAssistant) {
        throw new Error('Assistant not found');
      }
    }

    return {
      participant: updatedParticipant,
      assistant: updatedAssistant
    };
  } catch (error) {
    console.error('Failed to edit participant:', error);
    throw error;
  }
}

export async function updateParticipants(outcome: GameOutcome) {
    const { winner, loser } = outcome;
    
    if (!winner.currentStake || !loser.currentStake) {
        throw new Error('Missing stake information');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Calculate winnings in USD
        const maxWinnings = Math.min(
            winner.currentStake.amountUsd,
            loser.currentStake.amountUsd
        );

        const winnerWinnings = maxWinnings * 0.95; // 5% fee
        const turingBonus = maxWinnings * 0.1;     // 10% TURING bonus

        // Update winner
        const eloChange = calculateEloChange(winner.elo, loser.elo, 1);
        await Participant.findOneAndUpdate(
            { _id: winner._id },
            {
                $inc: {
                    elo: eloChange,
                    gamesPlayed: 1,
                    wins: 1,
                    winnings: winnerWinnings
                },
                $unset: { currentStake: "" }
            },
            { session }
        );

        // Update winner's token balance
        const winnerStake = new TokenAmount(
            winner.currentStake.tokenAmount,
            winner.currentStake.decimals
        );
        await winner.updateBalance(
            winner.currentStake.tokenAddress,
            winnerStake,
            winner.currentStake.chainId
        );

        // Update loser
        await Participant.findOneAndUpdate(
            { _id: loser._id },
            {
                $inc: {
                    elo: -eloChange,
                    gamesPlayed: 1
                },
                $unset: { currentStake: "" }
            },
            { session }
        );

        // Update loser's token balance (negative amount)
        const loserStake = new TokenAmount(
            `-${loser.currentStake.tokenAmount}`,
            loser.currentStake.decimals
        );
        await loser.updateBalance(
            loser.currentStake.tokenAddress,
            loserStake,
            loser.currentStake.chainId
        );

        await session.commitTransaction();

        // Return updated balances
        return {
            winner: {
                balances: winner.balances,
                eloChange: eloChange
            },
            loser: {
                balances: loser.balances,
                eloChange: -eloChange
            }
        };
    } catch (error) {
        await session.abortTransaction();
        console.error('Failed to update participants:', error);
        throw error;
    } finally {
        session.endSession();
    }
}

/**
 * Generates initial messages for an AI participant
 * @param participant - The AI participant to generate messages for
 * @returns Array of generated messages
 */
export async function generateInitialMessages(participant: Participant): Promise<string[]> {
  try {
    const assistant = await Assistant.findOne({ id: participant.id });
    if (!assistant) {
      throw new Error('No assistant config found for participant');
    }

    const openai = new OpenAI({
      apiKey: assistant.apiKey,
      baseURL: assistant.apiUrl
    });

    const prompts = [
      "hey how's it going?",
      "what's up?",
      "hi there!",
      "hello :)",
      "hey! how are you today?",
      "hey, nice to meet you!",
      "hi! ready to chat?",
      "hello there!",
      "hey friend!",
      "hi, how's your day?"
    ];

    const messages = await Promise.all(prompts.map(async prompt => {
      const response = await openai.chat.completions.create({
        model: assistant.modelName,
        messages: [
          { role: 'system', content: assistant.systemMsg },
          { role: 'user', content: prompt }
        ],
        ...assistant.params
      });

      return response.choices[0]?.message?.content || prompt;
    }));

    // Update assistant with new messages
    assistant.initialMsgs = messages;
    await assistant.save();

    return messages;
  } catch (error) {
    console.error('Error generating initial messages:', error);
    return [
      "Hey there!",
      "Hi, how are you?",
      "Hello! Nice to meet you",
      "Hey! How's your day going?",
      "Hi :) what's up?"
    ];
  }
}

/**
 * Gets a random initial message for an AI participant
 * @param participant - The AI participant to get a message for
 * @returns A random initial message
 */
export async function getInitialMessage(participant: Participant): Promise<string> {
  try {
    const assistant = await Assistant.findOne({ id: participant.id });
    if (!assistant || !assistant.initialMsgs?.length) {
      // If no messages exist, generate them first
      const messages = await generateInitialMessages(participant);
      return messages[Math.floor(Math.random() * messages.length)];
    }

    // Return random message from existing ones
    return assistant.initialMsgs[Math.floor(Math.random() * assistant.initialMsgs.length)];
  } catch (error) {
    console.error('Error getting initial message:', error);
    return "Hey there! How are you?"; // Fallback message
  }
}