import { Socket, Server } from 'socket.io';
import { chatSession } from '../models/chatSession';
import { Participant } from '../models/participant';
import { updateParticipants } from './participant';

interface ReportParams {
  sessionId: string;
  senderId: string;
  report: 'assistant' | 'user';
  targetId?: string;
}

export async function handleReport(socket: Socket, io: Server, params: ReportParams) {
  const { sessionId, senderId, report, targetId } = params;
  try {
    const session = await chatSession.findOne({ sessionId })
        .populate('participants');
        
    if (!session) {
        socket.emit('error', 'Chat session not found');
        return;
    }

    // Find target participant
    let target = session.participants.find(p => p.id === targetId);
    if (!target) {
        target = session.participants.find(p => p.id !== senderId);
    }
    if (!target) {
        socket.emit('error', 'Target not found');
        return;
    }

    // Determine winner/loser based on report correctness
    const isCorrect = (
        (report === 'assistant' && target.role === 'assistant') || 
        (report === 'user' && target.role === 'user')
    );

    // Get both participants in a single query
    const participants = await Participant.find({
        id: { $in: [senderId, target.id] }
    });

    const winner = participants.find(p => 
        isCorrect ? p.id === senderId : p.id === target.id
    );
    const loser = participants.find(p => 
        isCorrect ? p.id === target.id : p.id === senderId
    );

    if (!winner || !loser) {
        socket.emit('error', 'Failed to find participants');
        return;
    }
    // Update game outcome
    const gameResult = await updateParticipants({
        winner,
        loser,
        sessionId
    });
    console.log(gameResult);

    // Update session status
    await chatSession.updateOne(
        { sessionId },
        { 
            $set: { 
                status: 'ended',
                winner: winner.id
            }
        }
    );
    io.in(sessionId).emit('conclude', {
        winner: {
            id: winner.id,
            address: winner.address,
            alias: winner.alias,
            role: winner.role,
            balances: gameResult.winner.balances
        },
        loser: {
            id: loser.id,
            address: loser.address,
            alias: loser.alias,
            role: loser.role,
            balances: gameResult.loser.balances
        }
    });

  } catch (error) {
    console.error('Failed to process report:', error);
    socket.emit('error', error instanceof Error ? error.message : 'Failed to process report');
  }
}