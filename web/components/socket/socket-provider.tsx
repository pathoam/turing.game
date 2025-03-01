'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    console.log('Initializing socket connection'); // Debug log
    const socketIo = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001', {
      transports: ['websocket'],
      autoConnect: true
    });

    socketIo.on('connect', () => {
      console.log('Socket connected'); // Debug log
    });

    setSocket(socketIo);

    return () => {
      socketIo.close();
    };
  }, []);

  if (!socket) {
    return <div>Connecting to server...</div>; // Loading state
  }

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const socket = useContext(SocketContext);
  if (!socket) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return socket;
} 