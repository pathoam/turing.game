import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useWallet } from '@solana/wallet-adapter-react';

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { publicKey } = useWallet();
  const previousKeyRef = useRef<string | undefined>(undefined);
  const socketRef = useRef<Socket | null>(null); // Add ref to persist socket

  useEffect(() => {
    const currentKey = publicKey?.toString();
    const hasKeyChanged = previousKeyRef.current !== currentKey;
    previousKeyRef.current = currentKey;

    if (!socketRef.current) {
      console.log('Initializing socket connection');
      const newSocket = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001', {
        reconnection: true,
        timeout: 10000,
        transports: ['websocket'],
        autoConnect: true,
        forceNew: false,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5
      });

      const onConnect = () => {
        console.log('Socket connected, id:', newSocket.id);
        setIsConnected(true);
        
        if (currentKey) {
          console.log('Initializing participant for address:', currentKey);
          newSocket.emit('initialize_participant', { address: currentKey });
        }
      };

      const onReconnectAttempt = (attemptNumber: number) => {
        console.log('Reconnection attempt:', attemptNumber);
      };

      const onReconnectError = (error: Error) => {
        console.log('Reconnection error:', error);
      };

      newSocket.on('connect', onConnect);
      newSocket.on('reconnect_attempt', onReconnectAttempt);
      newSocket.on('reconnect_error', onReconnectError);
      
      socketRef.current = newSocket;
      setSocket(newSocket);
    } else if (hasKeyChanged && socketRef.current.connected) {
      // Handle wallet change when socket is connected
      if (currentKey) {
        console.log('Wallet changed, initializing with new address:', currentKey);
        socketRef.current.emit('initialize_participant', { address: currentKey });
      } else {
        console.log('Wallet disconnected');
      }
    }

    // Don't cleanup socket on every effect run
    return () => {
      // Only cleanup on component unmount
      if (socketRef.current && !socketRef.current.connected) {
        console.log('Cleaning up disconnected socket');
        socketRef.current.off();
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [publicKey]);

  // Add connection status monitoring
  useEffect(() => {
    const currentSocket = socketRef.current;
    if (!currentSocket) return;

    const onDisconnect = (reason: string) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
    };

    const onReconnect = (attemptNumber: number) => {
      console.log('Socket reconnected after', attemptNumber, 'attempts');
      setIsConnected(true);
    };

    currentSocket.on('disconnect', onDisconnect);
    currentSocket.on('reconnect', onReconnect);

    return () => {
      currentSocket.off('disconnect', onDisconnect);
      currentSocket.off('reconnect', onReconnect);
    };
  }, []);

  return socketRef.current;
}