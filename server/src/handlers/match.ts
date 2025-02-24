import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { chatSession } from '../models/chatSession';
import { Assistant } from '../models/assistant';
import { Participant, StakeInfo } from '../models/participant';

interface MatchingParticipant {
  participant: Participant;
  socketId: string;
  joinedAt: Date;
}

export type GameMode = 'casual' | 'ranked' | 'tournament';

// Generic matching criteria function type
type MatchCriteriaFn = (p1: MatchingParticipant, p2: MatchingParticipant) => boolean;

interface WaitingUser {
  participant: Participant;
  verificationScore: number;
  joinedAt: Date;
  socketId: string;
}

interface MatchCriteria {
  minVerificationScore: number;
  stakingRequired: boolean;
}

class MatchingPool {
  private participants: MatchingParticipant[] = [];
  private aiParticipants: Participant[] = [];  // Cached AI participants
  private matchCriteria: MatchCriteriaFn;
  private MIN_MATCH_DELAY = 3000;
  private MAX_MATCH_DELAY = 8000;
  private AI_MATCH_CHANCE = 0.5;

  constructor(matchCriteria: MatchCriteriaFn) {
    this.matchCriteria = matchCriteria;
    this.initializeAIParticipants();
  }

  private async initializeAIParticipants() {
    try {
      this.aiParticipants = await Participant.find({
        role: 'assistant',
        status: 'active'
      });
      console.log(`Initialized ${this.aiParticipants.length} AI participants`);
    } catch (error) {
      console.error('Failed to initialize AI participants:', error);
      this.aiParticipants = [];
    }
  }

  // Method to refresh AI participants periodically or on-demand
  public async refreshAIParticipants() {
    await this.initializeAIParticipants();
  }

  async tryMatch(participant: MatchingParticipant): Promise<MatchingParticipant | null> {
    console.log('Starting match process for:', participant.participant.id);
    
    this.participants.push(participant);

    return new Promise(async (resolve) => {
      const delay = Math.random() * (this.MAX_MATCH_DELAY - this.MIN_MATCH_DELAY) + this.MIN_MATCH_DELAY;
      console.log(`Will attempt match in ${delay}ms for:`, participant.participant.id);
      
      await new Promise(r => setTimeout(r, delay));

      if (!this.isParticipantInPool(participant.socketId)) {
        console.log('Participant disconnected during matching:', participant.participant.id);
        return null;
      }

      const humanMatch = this.findHumanMatch(participant);
      
      if (humanMatch && Math.random() > this.AI_MATCH_CHANCE) {
        console.log('Found human match:', humanMatch.participant.id);
        this.removeParticipant(humanMatch.socketId);
        this.removeParticipant(participant.socketId);
        resolve(humanMatch);
        return;
      }

      console.log('Finding AI match for:', participant.participant.id);
      this.removeParticipant(participant.socketId);
      
      const aiMatch = this.findAIMatch(participant);
      if (!aiMatch) {
        console.log('No eligible AI matches found');
        resolve(null);
        return;
      }

      console.log('Found matching AI:', {
        aiId: aiMatch.participant.id,
        aiElo: aiMatch.participant.elo,
        userElo: participant.participant.elo
      });

      resolve(aiMatch);
    });
  }

  private findAIMatch(participant: MatchingParticipant): MatchingParticipant | null {
    // Filter eligible AIs using match criteria
    const eligibleAIs = this.aiParticipants.filter(ai => {
      const aiMatchingParticipant: MatchingParticipant = {
        participant: ai,
        socketId: `ai-${ai.id}`,
        joinedAt: new Date()
      };
      return this.matchCriteria(participant, aiMatchingParticipant);
    });

    if (eligibleAIs.length === 0) {
      return null;
    }

    // Pick a random AI from eligible matches
    const selectedAI = eligibleAIs[Math.floor(Math.random() * eligibleAIs.length)];
    
    return {
      participant: selectedAI,
      socketId: `ai-${selectedAI.id}`,
      joinedAt: new Date()
    };
  }

  private findHumanMatch(participant: MatchingParticipant): MatchingParticipant | null {
    const candidates = this.participants
      .filter(p => 
        p.socketId !== participant.socketId && 
        this.matchCriteria(participant, p)
      )
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

    return candidates.length > 0 ? candidates[0] : null;
  }

  private isParticipantInPool(socketId: string): boolean {
    return this.participants.some(p => p.socketId === socketId);
  }

  removeParticipant(socketId: string) {
    this.participants = this.participants.filter(p => p.socketId !== socketId);
  }

  getCount(): number {
    return this.participants.length;
  }

  getParticipants(): MatchingParticipant[] {
    return [...this.participants];
  }
}

export class MatchingEngine {
  private pools: Map<GameMode, MatchingPool> = new Map();
  private io: Server;
  private AI_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

  constructor(io: Server) {
    this.io = io;
    this.initializePools();
    this.startAIRefreshInterval();
  }

  private startAIRefreshInterval() {
    setInterval(async () => {
      for (const pool of this.pools.values()) {
        await pool.refreshAIParticipants();
      }
    }, this.AI_REFRESH_INTERVAL);
  }

  private initializePools() {
    // Casual - match zero stakes together, and similar non-zero stakes together
    this.pools.set('casual', new MatchingPool((p1, p2) => {
      const stake1 = p1.participant.currentStake?.amount || 0;
      const stake2 = p2.participant.currentStake?.amount || 0;

      // Match zero stakes only with zero stakes
      if (stake1 === 0 || stake2 === 0) {
        return stake1 === stake2;
      }

      // For non-zero stakes, ensure they're within 20% of each other
      const maxStake = Math.max(stake1, stake2);
      const stakeDiff = Math.abs(stake1 - stake2);
      return stakeDiff / maxStake <= 0.2;
    }));

    // Ranked - require non-zero stakes, match by ELO and stakes
    this.pools.set('ranked', new MatchingPool((p1, p2) => {
      const stake1 = p1.participant.currentStake?.amount || 0;
      const stake2 = p2.participant.currentStake?.amount || 0;

      // Require non-zero stakes
      if (stake1 === 0 || stake2 === 0) {
        return false;
      }

      const maxStake = Math.max(stake1, stake2);
      const stakeDiff = Math.abs(stake1 - stake2);
      const eloDiff = Math.abs(p1.participant.elo - p2.participant.elo);
      
      return stakeDiff / maxStake <= 0.2 && eloDiff <= 200;
    }));

    // Tournament - require non-zero stakes, exact matches only
    // this.pools.set('tournament', new MatchingPool((p1, p2) => {
    //   const stake1 = p1.participant.currentStake?.amount || 0;
    //   const stake2 = p2.participant.currentStake?.amount || 0;

    //   // Require non-zero stakes
    //   if (stake1 === 0 || stake2 === 0) {
    //     return false;
    //   }

    //   return stake1 === stake2 && p1.participant.elo === p2.participant.elo;
    // }));
  }

  async tryMatch(socket: Socket, participantData: { id: string }, gameMode: GameMode) {
    const pool = this.pools.get(gameMode);
    if (!pool) {
      throw new Error(`Invalid game mode: ${gameMode}`);
    }
    console.log('Starting matchmaking process for:', participantData.id);

    // Fetch full participant object from database
    const participant = await Participant.findOne({ id: participantData.id });
    if (!participant) {
      throw new Error('Participant not found');
    }

    // Validate stake requirements
    const stake = participant.currentStake?.amount || 0;
    if ((gameMode === 'ranked' || gameMode === 'tournament') && stake === 0) {
      throw new Error(`${gameMode} mode requires a non-zero stake`);
    }

    const matchingParticipant: MatchingParticipant = {
      participant,
      socketId: socket.id,
      joinedAt: new Date()
    };

    console.log('Created matching participant:', {
      id: participant.id,
      elo: participant.elo,
      role: participant.role,
      stake
    });

    const match = await pool.tryMatch(matchingParticipant);
    if (match) {
      await this.createMatch(socket, matchingParticipant, match);
    }
  }

  removeParticipant(socketId: string) {
    for (const pool of this.pools.values()) {
      pool.removeParticipant(socketId);
    }
  }

private async createMatch(
    socket: Socket,
    participant1: MatchingParticipant,
    participant2: MatchingParticipant
) {
    const session = await chatSession.create({
        sessionId: uuidv4(),
        participants: [participant1.participant._id, participant2.participant._id],
        status: 'active',
        chatType: 'user',
        createdAt: new Date(),
        // Store stakes at match creation time
        participantStakes: {
            [participant1.participant.id]: participant1.participant.currentStake,
            [participant2.participant.id]: participant2.participant.currentStake
        }
    });

    socket.join(session.sessionId);
    const otherSocket = this.io.sockets.sockets.get(participant2.socketId);
    otherSocket?.join(session.sessionId);

    this.io.to(session.sessionId).emit('chat_started', session);
    console.log(`Match created - ${session.sessionId}`, {
        p1: {
            id: participant1.participant.id,
            elo: participant1.participant.elo,
            stake: participant1.participant.currentStake
        },
        p2: {
            id: participant2.participant.id,
            elo: participant2.participant.elo,
            stake: participant2.participant.currentStake
        }
    });
}

  getPoolStats(): Record<GameMode, number> {
    const stats = {} as Record<GameMode, number>;
    for (const [mode, pool] of this.pools.entries()) {
      stats[mode] = pool.getCount();
    }
    return stats;
  }

  // Helper method to check if a participant is still waiting in a pool
  isParticipantInPool(gameMode: GameMode, socketId: string): boolean {
    const pool = this.pools.get(gameMode);
    return pool?.getParticipants().some(p => p.socketId === socketId) ?? false;
  }
}

class EnhancedMatchingEngine {
  private matchParticipants(p1: WaitingUser, p2: WaitingUser, criteria: MatchCriteria): boolean {
    const verificationMatch = 
      p1.verificationScore >= criteria.minVerificationScore && 
      p2.verificationScore >= criteria.minVerificationScore;
      
    const stakingMatch = !criteria.stakingRequired || 
      (p1.participant.currentStake?.amount > 0 && p2.participant.currentStake?.amount > 0);
      
    return verificationMatch && stakingMatch;
  }
}