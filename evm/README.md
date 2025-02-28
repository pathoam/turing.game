# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.ts
```


# Game outline:
# Turing Tournament

Game is simple: player logs in, starts chatting and has to decide whether it’s chatting with an AI or a human. Player pays a dollar to play and can make more than a dollar if guesses correctly. Theoretically a player could claim to be a human, while using an AI, or plug into our AI port, and actually proxy to a human. But we actually have incentives to make that strategy suboptimal so we shouldn’t see it abused.

## Requirements:
Game must be fun

Signals for differentiating between AI and human must tilt towards accurate

Game needs to break-even in theory, though I am expecting to lose money backing our sole AI that will play

## Three game possibilities:
Claimed human v Claimed human

Claimed AI v Claimed human

Claimed AI v Claimed AI 

## Rewards

We need to have asymmetric incentives to keep the players from immediately choosing to cheat. A naive approach where the first agent to guess correctly wins just leads to players mixing signals (AI and human) to fool the opponent.

If we make it so that the optimal strategy depends on what the opponent is, and one of the optimal strategies isn’t to cheat, they shouldn’t immediately choose to cheat.

A homogenous matchup is when both players are of the same alleged type (human v human, or AI v AI). Heterogeneous is when they don’t match.



Homogenous matchup, Both guess correctly:

(.9,.9)

Homogenous matchup, At least one guesses incorrectly:

(-1,-1)

Heterogenous matchup, Both guess correctly:

First to guess correctly wins (.9,-1) 

Heterogenous matchup, At least one guesses incorrectly:

First inaccurately loses 
(-1,.9)


The homogenous matchup also disincentivizes collusion because of fees. Colluding, however, could mitigate the idea of using this directly as an authentication token. Since the game incentives are asymmetric, there should still be some signal to grant authentication. Colluders with multiple players simultaneously could know if they are playing against themselves. There is probably some math about fees lost versus increased probability of winning in the heterogeneous matchup to be solved here. I will leave that for future refinement. 

Humans or AI’s not cooperating effectively will lead to a growing balance in the smartcontract. We will have a permissionless function that can be called after the tournament is over that will pay out the balance to the player with the highest score. The score in the short term is total wins multiplied by win percentage. Long term we would want ELO instead.

## Considerations

We could further tweak the homogenous matchups by giving the first correct guesser a little more, but I think we should keep it simple.

Easy strategy we should probably mitigate: Guessing by population probability. Should make the chance of any matchup relatively equal.

AI might guess identities with minimal delay once it identifies patterns. Humans, even if they’re correct, might take longer to respond. That timing disadvantage can skew outcomes in AI vs. human matchups. I don’t consider this an actual problem. I think we should create the culture and aesthetic around the game as Man versus Machine since that’s what matters anyway.


