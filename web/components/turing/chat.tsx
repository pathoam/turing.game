'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useWallet } from '@solana/wallet-adapter-react';
import { Message, ChatSession, GameResult, GameMode } from '../types';


export default function TuringChat() {
  // Core state
  const { publicKey } = useWallet();
  const address = publicKey?.toString();
  const socket = useSocket();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [participantId, setParticipantId] = useState<string>();
  const [inputMessage, setInputMessage] = useState('');
  const [isMatching, setIsMatching] = useState(false);
  const [isOpponentTyping, setIsOpponentTyping] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [reportStatus, setReportStatus] = useState(false);
  const [showGameEndModal, setShowGameEndModal] = useState(false);
  const [selectedGameMode, setSelectedGameMode] = useState<GameMode>('casual');
  const [currentBalances, setCurrentBalances] = useState<{
      sol: number;
      usdc: number;
      turing: number;
  }>({
      sol: 0,
      usdc: 0,
      turing: 0
  });


  // Socket event listeners
  useEffect(() => {
    if (!socket || !address) return;

    socket.onAny((eventName, ...args) => {
      console.log('Received socket event:', {
          event: eventName,
          args,
          timestamp: new Date().toISOString()
      });
  });

    // Participant initialization
    socket.on('participant_initialized', ({ id }) => {
      console.log('Participant initialized with id:', id);
      setParticipantId(id);
    });

    // Chat events
    socket.on('chat_started', (session) => {
      console.log('Chat started:', session);
      setIsMatching(false);
      setSessionId(session.sessionId);
    });

    socket.on('chat_history', ({ messages: history }) => {
      console.log('Received chat history:', history);
      setMessages(history);
    });

    socket.on('new_message', (message: Message) => {
      setMessages(prev => [...prev, message]);
    });

    socket.on('typing', ({ senderId, isTyping }) => {
      // Only show typing indicator if it's not our own typing status
      if (senderId !== participantId) {
          setIsOpponentTyping(isTyping);
      }
    });
  

    // Game conclusion
    socket.on('conclude', (result: GameResult) => {
      console.log('Game concluded:', result);
      
      // Calculate winnings/losses for each token
      const differences = {
          sol: result.balances.sol - currentBalances.sol,
          usdc: result.balances.usdc - currentBalances.usdc,
          turing: result.balances.turing - currentBalances.turing
      };
      // Filter out zero differences

      setGameResult({
          ...result,
          differences: differences  // Add differences to game result
      });
      setCurrentBalances(result.balances);  // Update current balances
      setShowGameEndModal(true);
   });

    // Error handling
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      setIsMatching(false);
    });

    // Reconnection handling
    socket.on('connect', () => {
      console.log('Socket reconnected, requesting chat history');
      if (sessionId) {
        socket.emit('request_history', { sessionId });
      }
    });

    return () => {
      socket.off('participant_initialized');
      socket.off('chat_started');
      socket.off('chat_history');
      socket.off('new_message');
      socket.off('typing');
      socket.off('conclude');
      socket.off('error');
      socket.off('connect');
    };
  }, [socket, address, sessionId]); // Added sessionId to dependencies

  const resetChat = useCallback(() => {
    setSessionId(undefined);
    setMessages([]);
    setReportStatus(false);
    setGameResult(null);
    setShowGameEndModal(false);
    setInputMessage('');
    // Focus input after reset
    inputRef.current?.focus();
  }, []);


  // Message handlers
  const handleFindMatch = useCallback(() => {
    if (!socket || !participantId) {
      console.log('Cannot find match:', { socket: !!socket, participantId });
      return;
    }
    
    console.log('Finding match:', { 
      participantId, 
      gameMode: selectedGameMode 
    });
    
    setIsMatching(true);
    socket.emit('find_match', { 
      participant: { id: participantId }, 
      gameMode: selectedGameMode 
    });
  }, [socket, participantId, selectedGameMode]);

  const handleSendMessage = useCallback(() => {
    if (!socket || !sessionId || !participantId || !inputMessage.trim()) return;
    
    socket.emit('send_message', {
      sessionId,
      content: inputMessage.trim(),
      senderId: participantId,
    });
    setInputMessage('');
  }, [socket, sessionId, participantId, inputMessage]);

  type ReportChoice = 'assistant' | 'user';

  const handleControlButton = useCallback((choice: ReportChoice) => {
    if (!socket || !sessionId || !participantId || reportStatus) return;
    
    setReportStatus(true);
    console.log('Sending report:', { choice, sessionId, participantId });
    
    socket.emit('report', {
      sessionId,
      senderId: participantId,
      report: choice
    });
  }, [socket, sessionId, participantId, reportStatus]);

  useEffect(() => {
    if (sessionId) {
      inputRef.current?.focus();
    }
  }, [sessionId]);

  // Handle enter key globally
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (showGameEndModal) {
          resetChat();
        } else if (!sessionId) {
          handleFindMatch();
        }
      }
    };

    window.addEventListener('keypress', handleKeyPress);
    return () => window.removeEventListener('keypress', handleKeyPress);
  }, [showGameEndModal, sessionId, handleFindMatch, resetChat]);
  
    // Render loading state
    if (!address) {
      return (
        <div className="flex justify-center items-center h-[80vh]">
          <p>Please connect your wallet to continue</p>
        </div>
      );
    }

    return (
        <div className="flex flex-col h-[80vh] max-w-3xl mx-auto p-4 relative">
          {/* Chat Messages */}
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto mb-4 p-4 bg-base-200 rounded-lg">
            {messages.map((message, index) => (
              <div key={index} className={`mb-2 ${message.senderId === participantId ? 'text-right' : 'text-left'}`}>
                <span className={`inline-block p-2 rounded-lg max-w-[85%] ${
                  message.senderId === participantId ? 'bg-base-300' : 'bg-blue-500 text-white'
                }`}>
                  {message.content}
                </span>
              </div>
            ))}
            
            {isOpponentTyping && (
              <div className="text-left mb-2">
                <span className="inline-block p-2 text-sm opacity-70">
                  <span className="loading loading-dots loading-xs mr-2" />
                  Participant is typing...
                </span>
              </div>
            )}
          </div>
    
          {/* Input Field */}
          <div className="mb-4">
          <input
    ref={inputRef}
    type="text"
    value={inputMessage}
    onChange={(e) => {
      setInputMessage(e.target.value);
      // Only emit typing start when we first start typing
      if (socket && sessionId && !isTyping) {
          socket.emit('typing', { 
              sessionId,
              senderId: participantId,
              isTyping: true 
          });
          setIsTyping(true);
      }
    }}
    
    onKeyDown={(e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!sessionId) {
                handleFindMatch();
            } else if (!reportStatus && socket) {
                // Clear typing indicator before sending message
                if (isTyping) {
                    socket.emit('typing', { 
                        sessionId,
                        senderId: participantId,
                        isTyping: false 
                    });
                    setIsTyping(false);
                }
                handleSendMessage();
            }
        }
    }}
    placeholder={
        reportStatus 
            ? "Press Enter to start chat" 
            : sessionId 
                ? "Type your message..." 
                : "Press Enter to start chat"
    }
    className="w-full p-2 rounded-lg bg-base-200"
    disabled={!address || isMatching}
/>
          </div>
    
          {/* Control Buttons */}
          <div className="flex justify-center gap-4">

          {!sessionId && (
            <div className="mb-4">
            <select 
                value={selectedGameMode}
                onChange={(e) => setSelectedGameMode(e.target.value as GameMode)}
                className="select select-bordered w-full"
                disabled={isMatching}
            >
                <option value="casual">Casual</option>
                <option value="ranked">Ranked</option>
                {/* <option value="tournament">Tournament Match</option> */}
            </select>
            </div>
        )}
            <button 
              onClick={handleFindMatch}
              className="btn btn-primary"
              disabled={isMatching || !!sessionId || !address}
            >
              {sessionId ? 'Chat Active' : 'Start Chat'}
            </button>
            <button 
              onClick={() => handleControlButton('assistant')}
              className="btn btn-secondary"
              disabled={!sessionId || reportStatus}
            >
              AI
            </button>
            <button 
              onClick={() => handleControlButton('user')}
              className="btn btn-accent"
              disabled={!sessionId || reportStatus}
            >
              Human
            </button>

          </div>
    
          {/* Loading Overlay */}
          {isMatching && (
            <div className="absolute inset-0 bg-base-100 bg-opacity-50 flex items-center justify-center z-40">
              <div className="text-center">
                <div className="loading loading-spinner loading-lg mb-4" />
                <p className="text-lg font-semibold">Finding chat partner...</p>
              </div>
            </div>
          )}
    
          {/* Game End Modal */}
          {showGameEndModal && gameResult && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="modal-box bg-base-200 p-6 rounded-lg shadow-xl text-center">
                <h3 className="font-bold text-2xl mb-6">
                  Game Over!
                </h3>
    
                <div className="space-y-4 mb-6">
                  <p className="text-xl">
                    {gameResult.winner 
                      ? "Congratulations! You won! 🎉" 
                      : "Better luck next time! 🎮"}
                  </p>
    
                  {Object.entries(gameResult.differences || {}).every(([_, diff]) => diff === 0) ? (
                        <p className="text-xl font-semibold">
                            You won nothing 🤷
                        </p>
                    ) : (
                        Object.entries(gameResult.differences || {})
                            .filter(([_, diff]) => diff > 0)
                            .map(([token, diff]) => (
                                <p key={token} className="text-xl text-success font-semibold">
                                    You won {diff.toFixed(token === 'sol' ? 4 : 2)} {token.toUpperCase()} 💰
                                </p>
                            ))
                    )}
    
                  <div className="divider" />
    
                  <div className="text-base opacity-90">
                    <p className="mb-2">You were talking to:</p>
                    <p className="font-mono bg-base-300 p-2 rounded-lg break-all">
                      {gameResult.opponent.alias || 'Anonymous'}
                    </p>
                    <p className="font-mono text-sm bg-base-300 p-2 mt-2 rounded-lg break-all">
                      {gameResult.opponent.address || 'Unknown Address'}
                    </p>
                  </div>
                </div>
    
                <div className="modal-action justify-center">
                  <button 
                    className="btn btn-primary btn-wide"
                    onClick={resetChat}
                  >
                    Start New Game
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }