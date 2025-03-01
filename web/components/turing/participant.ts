'use client';

import { useAccount } from 'wagmi';
import { useSocket } from '../socket/socket-provider';
import { useEffect, useState } from 'react';

export function useParticipant() {
  const { address, isConnected } = useAccount();
  const socket = useSocket();

  const initializeParticipant = async (address: string, role = 'user') => {
    if (!address || !isConnected) return null;
    
    return new Promise((resolve, reject) => {
      socket.emit('initialize_participant', { address, role });
      
      socket.once('participant_initialized', (participant) => {
        resolve(participant);
      });

      socket.once('error', (error) => {
        reject(error);
      });
    });
  };

  return {
    initializeParticipant,
    isConnected,
    address
  };
}

export interface Participant {
    id: string;
    address: string;
    status: 'active' | 'inactive';
    role: 'user' | 'assistant';
    alias?: string;
    usdcBalance?: number;
    elo?: number;
    gamesPlayed?: number;
    wins?: number;
    winnings?: number;
  }