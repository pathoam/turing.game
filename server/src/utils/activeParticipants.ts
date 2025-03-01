import { Participant } from '../models/participant';

export class ActiveParticipantsManager {
    private participants: Map<string, Participant>;

    constructor() {
        this.participants = new Map();
    }

    public set(address: string, participant: Participant) {
        this.participants.set(address, participant);
    }

    public get(address: string): Participant | undefined {
        return this.participants.get(address);
    }

    // Add new helper methods
    public findById(participantId: string): Participant | undefined {
        return Array.from(this.participants.values())
            .find(p => p.id === participantId);
    }

    public getAll(): Participant[] {
        return Array.from(this.participants.values());
    }
}

export const activeParticipants = new ActiveParticipantsManager(); 