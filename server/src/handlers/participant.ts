import { Participant, GameOutcome, StakeInfo, Currency } from '../models/participant';
import { Assistant } from '../models/assistant'
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

export async function initParticipant(address: string, role: 'user' | 'assistant') {
    try {
      // Check if participant already exists
      let participant = await Participant.findOne({ address, role });
  
      // If no existing participant, create new one
      if (!participant) {
        participant = await Participant.create({
          id: uuidv4(),
          address,
          role,
          status: 'active',
          elo: 1000, // Starting ELO
          gamesPlayed: 0,
          wins: 0,
          winnings: 0,
          balances: {
            sol: 0,
            usdc: 0,
            turing: 0
          }
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
    
    // Calculate winnings based on stakes
    const maxWinnings = Math.min(
        winner.currentStake?.amount || 0,
        loser.currentStake?.amount || 0
    );

    // Calculate ELO changes
    const expectedScoreWinner = 1 / (1 + Math.pow(10, (loser.elo - winner.elo) / 400));
    const K = 32;
    const eloChangeWinner = Math.round(K * (1 - expectedScoreWinner));
    const eloChangeLoser = -eloChangeWinner;

    // Calculate rewards
    const winnerWinnings = maxWinnings * 0.95; // 5% fee
    const turingBonusWinner = maxWinnings * 0.25;
    const turingConsolation = maxWinnings * 0.125;

    // Update both participants in a single transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Update winner
        const updatedWinner = await Participant.findOneAndUpdate(
            { id: winner.id },
            {
                $inc: {
                    elo: eloChangeWinner,
                    gamesPlayed: 1,
                    wins: 1,
                    [`balances.${winner.currentStake?.currency || 'usdc'}`]: winnerWinnings,
                    'balances.turing': turingBonusWinner
                },
                $unset: { currentStake: "" }
            },
            { new: true, session }
        );

        // Update loser
        const updatedLoser = await Participant.findOneAndUpdate(
            { id: loser.id },
            {
                $inc: {
                    elo: eloChangeLoser,
                    gamesPlayed: 1,
                    [`balances.${loser.currentStake?.currency || 'usdc'}`]: -maxWinnings,
                    'balances.turing': turingConsolation
                },
                $unset: { currentStake: "" }
            },
            { new: true, session }
        );

        await session.commitTransaction();
        if (!updatedWinner || !updatedLoser) {
            throw new Error('Failed to update participants');
        }
        return {
            winner: {
                balances: updatedWinner.balances,
                eloChange: eloChangeWinner
            },
            loser: {
                balances: updatedLoser.balances,
                eloChange: eloChangeLoser
            }
        };

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}