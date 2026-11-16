# Nightwire

**Match munitions. Arm the base. Hold the line.** A mobile match-3 war game where every score is replayed on X Layer and every war machine thinks with a TapeOut circuit.

- Play: https://nightwire-blush.vercel.app (and `https://<id>-2-<processor>.tapekit.org/` on X Layer DeWEB at launch)
- Contracts (X Layer, chain 196): Armory processor `TBD`, NightwireEngine `TBD`, NightwireLadder `TBD`
- Code: `TBD`

## What it is

By day you swap munitions on an 8×8 board: bullets, shells, missiles, armour and wrenches. Matches arm real weapon tiers (M2 MG → Gatling → CIWS, Mortar → Howitzer → MLRS, Stinger → Javelin → Patriot), raise an Iron Dome shield and repair the base. Match 4 for a jet strafe, an L or T for a grenade, 5 for an airstrike beacon; long chains earn airstrikes. When the moves run out, the war machine attacks and your arsenal fires back. If it survives, it holds the sky and shells you every few moves until you finish it.

Eight war machines (IRONCLAW, STORMWING, DREADNOUGHT, HIVE CARRIER, BEHEMOTH, SPECTRE, TITAN, WARDEN), each with its own brain chip and signature weapon.

Modes: Solo, **World Boss raid** (OMEGA: everyone that week chips at one shared health pool), **VS AI** (Easy / Normal / Hard, live on the same battlefield beside you), **Daily Op** (one battlefield for everyone each UTC day), and **Duels** (a friend's exact run plays beside you as a ghost).

## How it uses TapeOut and X Layer

| Piece | What it does |
|---|---|
| **TapeOut circuits: the war machines' brains** | Each boss's combat brain is a NAND/LATCH netlist (TAP-02) taped out on our own processor, the *Nightwire Armory*. Before every attack the boss steps its chip with 7 input bits (its health, your base, your shield, its rage) and the 2 output bits choose Barrage, Focus Fire, EMP or Field Repair. LATCHes give them memory: IRONCLAW focuses every third shot, STORMWING EMPs a raised shield then follows up, DREADNOUGHT repairs once when hurt, the HIVE CARRIER alternates and keeps an emergency repair. The game runs the same netlists in the browser with a TAP-02 evaluator that matches the contracts' `step()` bit for bit. |
| **Chip Inspector** | Tap the boss bar (or "Boss chips" on the title screen) to see the boss's actual netlist as a gate diagram with live signal values. Flip input bits, step one beat and watch the LATCHes remember: the same circuit that decides the next attack. |
| **NightwireEngine (Solidity)** | A port of the game's rules engine. Given a seed and the moves, it replays the whole game, calling the Armory's `step()` for every boss decision, and returns the score. It matches the browser engine exactly on 200 of 200 test games, including random play and invalid airstrike timings. A long game costs about 32M gas to verify. |
| **NightwireLadder** | Leaderboards that only accept replayed scores: today's Daily Op board and an all-time board. A run can be submitted once (copies are rejected). Sealed duels: the challenger commits to their moves, the opponent plays the same seed, then the challenger reveals and both runs are replayed; a challenger who over-claims forfeits. Optional stakes (capped, off by default) and daily prize pools paid 50/30/20. |
| **NightwireRaid** | The weekly World Boss. Each raid run is replayed on chain against OMEGA (brain chip #9); its damage comes off one shared pool, contributions are ranked, and when OMEGA falls the week's top 3 raiders share the prize pool. |
| **TapeSend** | Players who hold a TapeOut circuit can send a duel straight to a friend's circuit name (e.g. `1.2.300`). It lands in their TapeSend inbox as a public TAP-10 message; Nightwire's inbox reads it back and checks its digest against the hub. |
| **DeWEB** | The whole game (10 files, ~160 KB, no off-chain code or fonts) is published to the X Layer site store under an Armory circuit's container, each file checked against its SHA-256. |

Nothing else is needed to trust a score: no server, no signer, no oracle. The chain replays the run.

## Who it is for and how we reach them

- **Mobile casual players** who already play match-3 daily. The core loop is a 2 to 4 minute session, one-thumb portrait, and runs smoothly on low-end phones (canvas sprites pre-rendered, frame-rate fallback). They play free with no wallet; chain features are optional extras.
- **Competitive players** who want rankings they can trust. Daily Op gives everyone the same battlefield every day, and the ladder only accepts replayed runs.
- **The TapeOut and X Layer community**, who already hold circuits: duels arrive in their TapeSend inbox, and the game's bosses show what small circuits can do.

Reach: challenge links and TapeSend duels make every run a share; the Daily Op gives a daily reason to come back and compare; OKX Wallet's in-app browser opens the game directly.

## Revenue

1. **World Boss prize pools**: a sponsored pool each week, paid to the top raiders when OMEGA falls (rolls over if it survives).
2. **Daily Op prize pools and entry tournaments**: sponsors or entry fees fund the pool; the ladder pays the top 3 and keeps 5%.
3. **Duel stakes**: optional, capped, skill-only (both players play the identical battlefield; scores are replayed). 5% of the pot.
4. **Armory transistors**: the Armory is our TapeOut processor, so every transistor minted on it (for new boss brains and future player-designed war machines) pays its creator.
5. Planned: cosmetic base and weapon skins, and a season pass for extra Daily Op boards.

## Why players pay and keep playing

- The same board for everyone makes a win mean something; replay verification means nobody can fake one.
- Duels against friends are personal, and the ghost replay shows exactly where you won or lost.
- Bosses with chip brains behave differently each fight, so learning each war machine is part of the skill.

## Honest status

- Built and tested: the game, AI, duels, Daily Op, the chip brains, the Solidity engine and ladder (rehearsed on a fork of X Layer mainnet with the real TapeOut contracts), DeWEB publishing and TapeSend sending and reading.
- TapeOut's TapeSend hub currently rejects circuits from processors created after the factory upgrade (their proxy code hash differs from the one the hub pins), so the Armory itself cannot send TapeSend messages yet; players' circuits on older processors can.
- Stakes and prize pools are off until we choose limits. Contracts are unaudited.
