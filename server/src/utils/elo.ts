export function calculateEloChange(winnerElo: number, loserElo: number, result: number): number {
    const K = 32;
    const expectedScore = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    return Math.round(K * (result - expectedScore));
} 