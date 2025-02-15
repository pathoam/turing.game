import { useVerification } from '@notbot-verify/react';

export function PlayerVerification() {
  const { startVerification, state } = useVerification();
  
  return (
    <div>
      <button onClick={startVerification}>
        Verify Player
      </button>
      {state.isVerifying && <span>Verifying...</span>}
    </div>
  );
} 