'use client';

import { useAccount } from 'wagmi';
import { useParticipant } from '../components/turing/participant';
import TuringChat from '../components/turing/chat';
import { useEffect, useState } from 'react';
import type { Participant } from '../components/turing/participant';

export default function Home() {
  const { address, isConnected } = useAccount();
  const [isLoading, setIsLoading] = useState(true);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const { initializeParticipant } = useParticipant();

  useEffect(() => {
    if (isConnected && address) {
      initializeParticipant(address, 'user')
        .then((p) => setParticipant(p as Participant))
        .catch(console.error)
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [isConnected, address]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isConnected) {
    return (
      <div className="text-center mt-20">
        <h1 className="text-2xl mb-4">Welcome to Turing Tournament</h1>
        <p>Please connect your wallet to continue</p>
      </div>
    );
  }

  if (!participant) {
    return <div>Loading participant data...</div>;
  }

  return <TuringChat participant={participant} />;
}