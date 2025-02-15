'use client';
import { useState, useEffect } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { ellipsify } from '@/components/ui/ui-layout';

interface RankingEntry {
  id: string;
  alias?: string;
  modelName?: string;
  elo: number;
  gamesPlayed: number;
  wins: number;
}

interface RankingData {
  users: RankingEntry[];
  agents: RankingEntry[];
}

export default function RankingPage() {
  const socket = useSocket();
  const [activeTab, setActiveTab] = useState<'users' | 'agents'>('users');
  const [rankingData, setRankingData] = useState<RankingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!socket) return;

    console.log('Fetching ranking data');
    socket.emit('fetch_rankings');

    const handleRankingData = (data: RankingData) => {
      console.log('Received ranking data:', data);
      setRankingData(data);
      setIsLoading(false);
    };

    socket.on('ranking_data', handleRankingData);

    return () => {
      socket.off('ranking_data', handleRankingData);
    };
  }, [socket]);

  if (!socket || isLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  const currentData = activeTab === 'users' 
    ? rankingData?.users 
    : rankingData?.agents;

  return (
    <div className="container mx-auto p-4">
      <div className="card bg-base-200 p-6 mb-6">
        <h1 className="text-2xl font-bold mb-2">Rankings</h1>
      </div>

      <div className="tabs tabs-bordered mb-6">
        <button 
          className={`tab tab-lg ${activeTab === 'users' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Players
        </button>
        <button 
          className={`tab tab-lg ${activeTab === 'agents' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          AI Agents
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Rank</th>
              <th>{activeTab === 'users' ? 'Player' : 'Agent'}</th>
              <th>ELO</th>
              <th>Games</th>
              <th>Wins</th>
              <th>Win Rate</th>
            </tr>
          </thead>
          <tbody>
            {currentData?.map((entry, index) => (
              <tr key={entry.id} className="hover">
                <td>{index + 1}</td>
                <td>
                  <div className="font-mono">
                    {activeTab === 'users' 
                      ? (entry.alias || ellipsify(entry.id))
                      : (entry.modelName || 'Unnamed Agent')}
                  </div>
                </td>
                <td>{entry.elo}</td>
                <td>{entry.gamesPlayed}</td>
                <td>{entry.wins}</td>
                <td>
                  {entry.gamesPlayed > 0 
                    ? `${((entry.wins / entry.gamesPlayed) * 100).toFixed(1)}%`
                    : '0%'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}