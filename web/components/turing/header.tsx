'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { WalletButton } from '../wallet/wallet-button';
import { ellipsify } from '../ui/ui-layout';

export function TuringHeader() {
  const { address } = useAccount();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="navbar bg-base-100">
      <div className="flex-1">
        <span className="text-xl font-bold">Turing Tournament</span>
        <div className="ml-8 flex items-center space-x-4">
          <div className="h-8 flex items-center">
            <Link 
              href="/" 
              className="btn btn-primary btn-sm h-8 min-h-0 text-white"
            >
              Play Now
            </Link>
          </div>
          <div className="h-8 flex items-center">
            <Link href="/account" className="link-hover">Account</Link>
          </div>
          <div className="h-8 flex items-center">
            <Link href="/rankings" className="link-hover">Rankings</Link>
          </div>
        </div>
      </div>
      <div className="flex-none gap-2">
        {mounted && (
          <>
            {address && (
              <div className="hidden md:flex items-center">
                {/* <span className="text-sm font-mono">
                  {ellipsify(address)}
                </span> */}
              </div>
            )}
            <WalletButton />
          </>
        )}
      </div>
    </div>
  );
}