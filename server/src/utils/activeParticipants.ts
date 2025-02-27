import { Participant } from '../models/participant';

class ActiveParticipantsManager {
    private static instance: ActiveParticipantsManager;
    private participants: Map<string, Participant>;

    private constructor() {
        this.participants = new Map();
    }

    public static getInstance(): ActiveParticipantsManager {
        if (!ActiveParticipantsManager.instance) {
            ActiveParticipantsManager.instance = new ActiveParticipantsManager();
        }
        return ActiveParticipantsManager.instance;
    }

    public get(address: string): Participant | undefined {
        return this.participants.get(address);
    }

    public set(address: string, participant: Participant): void {
        this.participants.set(address, participant);
    }

    public delete(address: string): void {
        this.participants.delete(address);
    }
}

export const activeParticipants = ActiveParticipantsManager.getInstance(); 