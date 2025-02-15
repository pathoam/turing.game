'use client';
import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { ellipsify } from '../../components/ui/ui-layout';
import { useSocket } from '@/hooks/useSocket';
import { UserProfile, AIProfile } from '@/components/account/profiles';

import { 
  Participant, 
  Assistant, 
  AssistantResponse, 
  ParticipantsResponse 
} from '../../components/types';

export default function AccountPage() {
  const { publicKey } = useWallet();
  const socket = useSocket();
  const [activeTab, setActiveTab] = useState<'user' | 'ai'>('user');
  const [profileData, setProfileData] = useState<any>(null);
  const [assistantData, setAssistantData] = useState<any>(null);
  const [participantsData, setParticipantsData] = useState<ParticipantsResponse | null>(null);

  const [isLoading, setIsLoading] = useState(true);

  // Single useEffect for data fetching
  useEffect(() => {
    if (!socket || !publicKey) {
      console.log('Dependencies not ready:', { hasSocket: !!socket, hasPublicKey: !!publicKey });
      return;
    }

    console.log('Dependencies ready, fetching data');
    const address = publicKey.toString();
    setIsLoading(true);

    socket.emit('fetch_participants', { address });

    const handleParticipantsData = (response: ParticipantsResponse) => {
      console.log('Received participants data:', response);
      if (response.user && Array.isArray(response.assistants)) {
        setParticipantsData({
          user: response.user,
          assistants: response.assistants.map(assistant => ({
            participant: assistant.participant,
            assistant: assistant.assistant
          }))
        });
      } else {
        console.error('Malformed participants data:', response);
      }
      setIsLoading(false);
    };

    const handleError = (error: string) => {
      console.error('Socket error:', error);
      setIsLoading(false);
    };

    socket.on('participants_data', handleParticipantsData);
    socket.on('error', handleError);

    return () => {
      socket.off('participants_data', handleParticipantsData);
      socket.off('error', handleError);
    };
  }, [socket, publicKey]);

  // Render loading state if socket isn't ready
  if (!socket) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  // Render wallet connection prompt if no wallet
  if (!publicKey) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <p className="text-lg">Please connect your wallet to view account details</p>
      </div>
    );
  }

  // Main render
  return (
    <div className="container mx-auto p-4">
      <div className="card bg-base-200 p-6 mb-6">
        <h1 className="text-2xl font-bold mb-2">Account</h1>
        <p className="font-mono text-sm">
          {ellipsify(publicKey.toString())}
        </p>
      </div>

      <div className="tabs tabs-bordered mb-6">
        <button 
          className={`tab tab-lg ${activeTab === 'user' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('user')}
        >
          User Profile
        </button>
        <button 
          className={`tab tab-lg ${activeTab === 'ai' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('ai')}
        >
          AI Agent
        </button>
      </div>

      <div className="p-4">
        {activeTab === 'user' ? (
          <UserProfile 
            data={participantsData?.user || null} 
            isLoading={isLoading} 
            address={publicKey.toString()} 
          />
        ) : (
          <AIProfile 
            data={participantsData?.assistants || []} 
            isLoading={isLoading} 
            address={publicKey.toString()} 
          />
        )}
      </div>
    </div>
  );
}
