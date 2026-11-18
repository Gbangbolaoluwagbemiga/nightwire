// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICircuits} from "./ITapeOut.sol";

/// @title Nightwire rules engine, on chain
/// @notice A line-for-line port of src/engine.js. Given a seed and a player's actions it replays the whole game
///         and returns the score, so a leaderboard can accept only scores that really happened. The war machines'
///         brains are TapeOut circuits: before each attack the engine calls `step` on the Armory processor.
/// @dev    Integers only. HP, damage, shield and base are in tenths; weapon charge is in half-points; fight
///         times are in milliseconds. Action bytes: a move is one byte < 128 (cell * 2 + dir, dir 0 = swap with
///         the cell to the right, 1 = with the cell below); a night is 0x80 | k followed by k airstrike call
///         times as big-endian uint16 milliseconds.
contract NightwireEngine {
    uint256 constant N = 8;
    uint8 constant CORE = 5;
    uint8 constant SP_ROW = 1;
    uint8 constant SP_COL = 2;
    uint8 constant SP_BOMB = 3;
    uint8 constant SP_CORE = 4; // only used in "creates"
    uint32 constant MOVES_PER_DAY = 14;
    uint32 constant MAX_STRIKES = 9;
    uint32 constant BASE_MAX = 1000;
    uint32 constant NIGHT_START = 2000;
    uint32 constant BOSS_AIM = 380;
    uint32 constant BOSS_FLIGHT = 700;
    uint32 constant MEDIC_PCT = 60;
    uint32 constant MAX_BAZOOKA = 9;

    ICircuits public immutable armory;
    uint256[9] public brainIds; // ironclaw, stormwing, dreadnought, hive, behemoth, spectre, titan, warden, omega (raid)
    uint8[9] internal brainStateBits;

    constructor(ICircuits armory_, uint256[9] memory ids) {
        armory = armory_;
        brainIds = ids;
        for (uint256 i; i < 9; i++) {
            (uint32 nIn, uint32 nOut, uint32 nState,) = armory_.circuitInfo(ids[i]);
            require(nIn == 7 && nOut == 2 && nState <= 8, "brain pins");
            brainStateBits[i] = uint8(nState);
        }
    }

    struct G {
        uint32 rs; // supply RNG state
        uint32 crs; // crit RNG state
        uint256 c; // colour per cell, 4 bits each (cell k at bits 4k..4k+3): 0..4, CORE = beacon
        uint256 sp; // special per cell, 4 bits each: 0, SP_ROW, SP_COL, SP_BOMB
        uint256[] runBuf; // scratch, reused
        uint256 score;
        uint32 stageNo;
        uint32 bossesDown;
        uint32 moves;
        uint32 base;
        uint32 shield;
        uint32[5] charge;
        uint32 strikes;
        uint32 bazooka; // loaded by matches of 5, fired at nightfall
        uint32 cascade;
        bool over;
        // boss
        uint32 hp;
        uint32 maxHp;
        uint32 rage;
        bool present;
        uint8 btype;
        uint8 brain; // packed state bits
        uint256 damage; // total damage dealt this run (the raid contribution)
        uint256 customBrain; // Boss Forge: an Armory circuit used as every boss's brain (0 = built-in brains)
        uint8 customBits;
    }

    struct Result {
        bool ok;
        bool over;
        uint256 score;
        uint32 stage;
        uint32 bossesDown;
        uint256 failedAt; // action index where replay failed (when !ok)
        uint256 damage; // total damage dealt (tenths)
    }

    // ------------------------------------------------------------------ randomness (mulberry32)
    function _next(uint32 s) internal pure returns (uint32 ns, uint32 out) {
        unchecked {
            uint32 t = s + 0x6D2B79F5;
            ns = t;
            t = (t ^ (t >> 15)) * (t | 1);
            t ^= t + (t ^ (t >> 7)) * (t | 61);
            out = t ^ (t >> 14);
        }
    }

    function _r5(G memory g) internal pure returns (uint8) {
        uint32 o;
        (g.rs, o) = _next(g.rs);
        return uint8((uint256(o) * 5) >> 32);
    }

    function _rdiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (2 * a + b) / (2 * b);
    }

    function _gc(G memory g, uint256 k) internal pure returns (uint8) {
        return uint8((g.c >> (k << 2)) & 0xf);
    }

    function _gs(G memory g, uint256 k) internal pure returns (uint8) {
        return uint8((g.sp >> (k << 2)) & 0xf);
    }

    function _sc(G memory g, uint256 k, uint256 v) internal pure {
        g.c = (g.c & ~(uint256(0xf) << (k << 2))) | (v << (k << 2));
    }

    function _ss(G memory g, uint256 k, uint256 v) internal pure {
        g.sp = (g.sp & ~(uint256(0xf) << (k << 2))) | (v << (k << 2));
    }

    // ------------------------------------------------------------------ setup
    function _makeBoss(G memory g) internal pure {
        uint256 hp = 1300;
        for (uint256 i = 1; i < g.stageNo; i++) {
            hp = _rdiv(hp * 160, 100);
        }
        g.hp = uint32(hp);
        g.maxHp = uint32(hp);
        g.rage = 0;
        g.present = false;
        g.btype = uint8((g.stageNo - 1) % 8);
        g.brain = 0;
    }

    uint32 constant RAID_HP = 1_000_000_000;

    function _newRun(uint32 seed, bool raid) internal pure returns (G memory g) {
        g.rs = seed;
        unchecked {
            g.crs = seed ^ 0x5bd1e995;
        }
        g.stageNo = 1;
        g.moves = MOVES_PER_DAY;
        g.base = BASE_MAX;
        g.runBuf = new uint256[](32);
        _makeBoss(g);
        if (raid) { // OMEGA, the world boss: nobody kills it alone
            g.hp = RAID_HP;
            g.maxHp = RAID_HP;
            g.btype = 8;
        }
        _freshBoard(g);
    }

    function _freshBoard(G memory g) internal pure {
        while (true) {
            g.sp = 0;
            for (uint256 r; r < N; r++) {
                for (uint256 c; c < N; c++) {
                    uint8 col;
                    while (true) {
                        col = _r5(g);
                        bool h = c >= 2 && _gc(g, r * 8 + c - 1) == col && _gc(g, r * 8 + c - 2) == col;
                        bool v = r >= 2 && _gc(g, (r - 1) * 8 + c) == col && _gc(g, (r - 2) * 8 + c) == col;
                        if (!h && !v) break;
                    }
                    _sc(g, r * 8 + c, col);
                }
            }
            if (_findMove(g)) return;
        }
    }

    // ------------------------------------------------------------------ board
    function _swap(G memory g, uint256 a, uint256 b) internal pure {
        uint8 ca = _gc(g, a);
        uint8 sa = _gs(g, a);
        _sc(g, a, _gc(g, b));
        _ss(g, a, _gs(g, b));
        _sc(g, b, ca);
        _ss(g, b, sa);
    }

    // ---- bitboards in nibble space: cell k is bit 4k of a uint256 (the same layout as the packed board)
    uint256 constant ONES = 0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 constant SEVENS = 0x7777777777777777777777777777777777777777777777777777777777777777;
    uint256 constant NOT_C7 = 0x0111111101111111011111110111111101111111011111110111111101111111; // column < 7
    uint256 constant NOT_C0 = 0x1111111011111110111111101111111011111110111111101111111011111110; // column > 0
    uint256 constant C_LE5 = 0x0011111100111111001111110011111100111111001111110011111100111111; // column <= 5
    uint256 constant C_GE2 = 0x1111110011111100111111001111110011111100111111001111110011111100; // column >= 2
    uint256 constant COL0 = 0x0000000100000001000000010000000100000001000000010000000100000001;

    /// cells whose colour is `col`, one bit per cell (bit 4k)
    function _mask(uint256 board, uint256 col) internal pure returns (uint256) {
        uint256 x = board ^ (col * ONES);
        uint256 y = (x & SEVENS) + SEVENS;
        return (~(y | x | SEVENS)) >> 3 & ONES;
    }

    /// Is there any legal move? (a beacon anywhere, or a swap that makes a line of 3)
    function _findMove(G memory g) internal pure returns (bool) {
        uint256 bc = g.c;
        if (_mask(bc, CORE) != 0) return true;
        for (uint256 col; col < 5; col++) {
            uint256 z = _mask(bc, col);
            uint256 r1 = (z >> 4) & NOT_C7; // z(p+1)
            uint256 r2 = (z >> 8) & C_LE5; // z(p+2)
            uint256 l1 = (z << 4) & NOT_C0; // z(p-1)
            uint256 l2 = (z << 8) & C_GE2; // z(p-2)
            uint256 d1 = z >> 32; // z(p+8)
            uint256 d2 = z >> 64; // z(p+16)
            uint256 u1 = z << 32; // z(p-8)
            uint256 u2 = z << 64; // z(p-16)
            uint256 L2 = l1 & l2;
            uint256 R2 = r1 & r2;
            uint256 HM = l1 & r1;
            uint256 U2 = u1 & u2;
            uint256 D2 = d1 & d2;
            uint256 VM = u1 & d1;
            // a gem of this colour moves into p from q; the line through p may not use q
            if (
                (r1 & (L2 | U2 | D2 | VM)) | (l1 & (R2 | U2 | D2 | VM)) | (d1 & (U2 | L2 | R2 | HM))
                        | (u1 & (D2 | L2 | R2 | HM)) != 0
            ) {
                return true;
            }
        }
        return false;
    }

    /// index of the lowest set bit (x != 0)
    function _low(uint256 x) internal pure returns (uint256 i) {
        unchecked {
            x = x & (~x + 1);
        }
        if (x >> 128 != 0) {
            i += 128;
            x >>= 128;
        }
        if (x >> 64 != 0) {
            i += 64;
            x >>= 64;
        }
        if (x >> 32 != 0) {
            i += 32;
            x >>= 32;
        }
        if (x >> 16 != 0) {
            i += 16;
            x >>= 16;
        }
        if (x >> 8 != 0) {
            i += 8;
            x >>= 8;
        }
        if (x >> 4 != 0) {
            i += 4;
            x >>= 4;
        }
        if (x >> 2 != 0) {
            i += 2;
            x >>= 2;
        }
        if (x >> 1 != 0) i += 1;
    }

    /// runs packed as: dir (bit 0: 0 h, 1 v) | colour << 1 | start << 8 | len << 16
    function _findRuns(G memory g) internal pure returns (uint256[] memory runs, uint256 n) {
        runs = g.runBuf;
        uint256 bc = g.c;
        uint256 hs; // run starts, all colours (colours never share a cell)
        uint256 vs;
        uint256 hcovAll;
        uint256 vcovAll;
        for (uint256 col; col < 5; col++) {
            uint256 z = _mask(bc, col);
            uint256 h3 = z & ((z >> 4) & NOT_C7) & ((z >> 8) & C_LE5);
            uint256 v3 = z & (z >> 32) & (z >> 64);
            if (h3 | v3 == 0) continue;
            uint256 hcov = h3 | (h3 << 4) | (h3 << 8);
            uint256 vcov = v3 | (v3 << 32) | (v3 << 64);
            hs |= hcov & ~((hcov << 4) & NOT_C0);
            vs |= vcov & ~(vcov << 32);
            hcovAll |= hcov;
            vcovAll |= vcov;
        }
        // horizontal runs in row-major order (lowest cell first)
        while (hs != 0) {
            uint256 bit = _low(hs);
            hs &= hs - 1;
            uint256 k = bit >> 2;
            uint256 len = 1;
            while (
                (k % 8) + len < N && (hcovAll >> ((k + len) << 2)) & 1 == 1
                    && (bc >> ((k + len) << 2)) & 0xf == (bc >> (k << 2)) & 0xf
            ) len++;
            runs[n++] = 0 | (((bc >> (k << 2)) & 0xf) << 1) | (k << 8) | (len << 16);
        }
        // vertical runs in column-major order
        for (uint256 c; c < N && vs != 0; c++) {
            uint256 x = vs & (COL0 << (c << 2));
            vs &= ~x;
            while (x != 0) {
                uint256 bit = _low(x);
                x &= x - 1;
                uint256 k = bit >> 2;
                uint256 len = 1;
                while (
                    (k >> 3) + len < N && (vcovAll >> ((k + len * 8) << 2)) & 1 == 1
                        && (bc >> ((k + len * 8) << 2)) & 0xf == (bc >> (k << 2)) & 0xf
                ) len++;
                runs[n++] = 1 | (((bc >> (k << 2)) & 0xf) << 1) | (k << 8) | (len << 16);
            }
        }
    }

    function _runCell(uint256 run, uint256 j) internal pure returns (uint256) {
        uint256 start = (run >> 8) & 0xff;
        return (run & 1) == 0 ? start + j : start + j * 8;
    }

    struct Creates {
        uint256 n;
        uint8[32] key;
        uint8[32] sp;
        uint64 mask;
    }

    function _resolveRuns(G memory g, uint256[] memory runs, uint256 nRuns, uint256 sa, uint256 sb, bool hasSwap)
        internal
        pure
        returns (uint64 clear, Creates memory cr)
    {
        uint64 H;
        uint64 V;
        for (uint256 i; i < nRuns; i++) {
            uint256 len = (runs[i] >> 16) & 0xff;
            for (uint256 j; j < len; j++) {
                uint64 bit = uint64(1) << _runCell(runs[i], j);
                clear |= bit;
                if ((runs[i] & 1) == 0) H |= bit;
                else V |= bit;
            }
        }
        for (uint256 i; i < nRuns; i++) {
            uint256 run = runs[i];
            uint256 len = (run >> 16) & 0xff;
            uint8 sp;
            uint256 at = 999;
            for (uint256 j; j < len; j++) {
                uint256 k = _runCell(run, j);
                if ((H >> k) & 1 == 1 && (V >> k) & 1 == 1) {
                    sp = SP_BOMB;
                    at = k;
                    break;
                }
            }
            if (sp == 0) {
                if (len >= 5) sp = SP_CORE;
                else if (len == 4) sp = (run & 1) == 0 ? SP_ROW : SP_COL;
                else continue;
            }
            if (at == 999) {
                uint256 nc;
                for (uint256 j; j < len; j++) {
                    uint256 k = _runCell(run, j);
                    if (_gs(g, k) == 0) {
                        if (hasSwap && at == 999 && (k == sa || k == sb)) at = k;
                        nc++;
                    }
                }
                if (at == 999 && nc > 0) {
                    // the middle candidate
                    uint256 want = nc / 2;
                    for (uint256 j; j < len; j++) {
                        uint256 k = _runCell(run, j);
                        if (_gs(g, k) == 0) {
                            if (want == 0) {
                                at = k;
                                break;
                            }
                            want--;
                        }
                    }
                }
                if (at == 999) continue;
            }
            if ((cr.mask >> at) & 1 == 0) {
                cr.mask |= uint64(1) << at;
                cr.key[cr.n] = uint8(at);
                cr.sp[cr.n] = sp;
                cr.n++;
            }
        }
        clear &= ~cr.mask;
    }

    function _addStrike(G memory g) internal pure {
        if (g.strikes < MAX_STRIKES) g.strikes++;
    }

    function _applyClear(G memory g, uint64 clear, Creates memory cr) internal pure returns (uint64) {
        // set off every special caught in the blast, until nothing new is caught
        uint64 fired;
        bool changed = true;
        while (changed) {
            changed = false;
            uint64 todo = clear & ~fired;
            while (todo != 0) {
                uint256 k = _low(todo);
                todo &= todo - 1;
                uint8 spk = _gs(g, k);
                if (spk == 0) continue;
                fired |= uint64(1) << k;
                changed = true;
                uint256 r = k / 8;
                uint256 c = k % 8;
                uint64 add;
                if (spk == SP_ROW) {
                    add = uint64(0xff) << (r * 8);
                } else if (spk == SP_COL) {
                    add = uint64(0x0101010101010101) << c;
                } else {
                    for (uint256 dy; dy < 3; dy++) {
                        for (uint256 dx; dx < 3; dx++) {
                            if (r + dy < 1 || r + dy > 8 || c + dx < 1 || c + dx > 8) continue;
                            add |= uint64(1) << ((r + dy - 1) * 8 + (c + dx - 1));
                        }
                    }
                }
                clear |= add & ~cr.mask;
            }
        }
        uint32 mulH = g.cascade + 1;
        uint256 n;
        uint64 left = clear;
        while (left != 0) {
            uint256 k = _low(left);
            left &= left - 1;
            n++;
            uint8 ck = _gc(g, k);
            if (ck < CORE) g.charge[ck] += mulH;
        }
        for (uint256 i; i < cr.n; i++) {
            uint256 k = cr.key[i];
            if (cr.sp[i] == SP_CORE) {
                _sc(g, k, CORE);
                _ss(g, k, 0);
                _addStrike(g);
                if (g.bazooka < MAX_BAZOOKA) g.bazooka++;
            } else {
                _ss(g, k, cr.sp[i]);
            }
        }
        g.score += n * 10 * g.cascade;
        return clear;
    }

    function _dropAndRefill(G memory g, uint64 gone) internal pure {
        unchecked {
            uint256 bc = g.c;
            uint256 bs = g.sp;
            uint32 rs = g.rs;
            for (uint256 c; c < N; c++) {
                if ((gone >> c) & 0x0101010101010101 == 0) continue;
                uint256 write = 8; // next free row + 1
                for (uint256 r = 8; r > 0; r--) {
                    uint256 k = (r - 1) * 8 + c;
                    if ((gone >> k) & 1 == 0) {
                        uint256 w = (write - 1) * 8 + c;
                        if (w != k) {
                            uint256 sk = k << 2;
                            uint256 sw = w << 2;
                            bc = (bc & ~(uint256(0xf) << sw)) | (((bc >> sk) & 0xf) << sw);
                            bs = (bs & ~(uint256(0xf) << sw)) | (((bs >> sk) & 0xf) << sw);
                        }
                        write--;
                    }
                }
                for (uint256 r = write; r > 0; r--) {
                    uint256 sh = ((r - 1) * 8 + c) << 2;
                    uint32 o;
                    (rs, o) = _next(rs);
                    bc = (bc & ~(uint256(0xf) << sh)) | (((uint256(o) * 5) >> 32) << sh);
                    bs &= ~(uint256(0xf) << sh);
                }
            }
            g.c = bc;
            g.sp = bs;
            g.rs = rs;
        }
    }

    function _shuffle(G memory g) internal pure {
        for (uint256 tries; tries < 60; tries++) {
            for (uint256 k; k < 64; k++) {
                if (_gc(g, k) != CORE && _gs(g, k) == 0) _sc(g, k, _r5(g));
            }
            (, uint256 nr) = _findRuns(g);
            if (nr == 0 && _findMove(g)) return;
        }
    }

    function _useMove(G memory g) internal pure {
        g.moves--;
        if (g.present && g.moves > 0 && (MOVES_PER_DAY - g.moves) % 4 == 0) {
            uint32 dmg = (3 + 2 * g.stageNo + g.rage) * 10;
            uint32 absorbed = dmg < g.shield ? dmg : g.shield; // the shield stays up until knocked down
            g.shield -= absorbed;
            dmg -= absorbed;
            g.base = g.base > dmg ? g.base - dmg : 1; // daytime assaults can't finish the base
        }
    }

    /// @dev returns (legal, status): status 0 idle, 1 night, 2 over
    function _playMove(G memory g, uint256 a, uint256 b) internal pure returns (bool legal, uint8 status) {
        if (g.over || g.moves == 0) return (false, 0);
        _swap(g, a, b);
        uint64 clear;
        Creates memory cr;
        uint8 ga = _gc(g, b);
        uint8 gb = _gc(g, a);
        if (ga == CORE || gb == CORE) {
            if (ga == CORE && gb == CORE) {
                clear = type(uint64).max;
            } else {
                uint256 core = ga == CORE ? b : a;
                uint8 other = ga == CORE ? gb : ga;
                clear = uint64(1) << core;
                for (uint256 k; k < 64; k++) {
                    if (_gc(g, k) == other) clear |= uint64(1) << k;
                }
            }
        } else {
            (uint256[] memory runs, uint256 nr) = _findRuns(g);
            if (nr == 0) {
                _swap(g, a, b);
                return (false, 0);
            }
            (clear, cr) = _resolveRuns(g, runs, nr, a, b, true);
        }
        _useMove(g);
        g.cascade = 1;
        uint64 gone = _applyClear(g, clear, cr);
        while (true) {
            _dropAndRefill(g, gone);
            (uint256[] memory runs, uint256 nr) = _findRuns(g);
            if (nr == 0) break;
            g.cascade++;
            (clear, cr) = _resolveRuns(g, runs, nr, 0, 0, false);
            gone = _applyClear(g, clear, cr);
        }
        // finish the turn
        if (g.cascade >= 3) _addStrike(g);
        g.cascade = 0;
        if (g.base == 0) {
            g.over = true;
            return (true, 2);
        }
        if (g.moves == 0) return (true, 1);
        if (!_findMove(g)) _shuffle(g);
        return (true, 0);
    }

    // ------------------------------------------------------------------ night
    function _tierOf(uint256 i, uint256 v) internal pure returns (uint256) {
        if (i < 3) return v >= 10 ? 2 : v >= 5 ? 1 : 0;
        if (i == 3) return v >= 40 ? 2 : v >= 20 ? 1 : 0;
        return v >= 16 ? 2 : v >= 8 ? 1 : 0;
    }

    function _tierPct(uint256 t) internal pure returns (uint256) {
        return t == 0 ? 100 : t == 1 ? 125 : 160;
    }

    // heap of fight items: key = t << 40 | q << 8 | type ; payload in a parallel array
    // types: 0 heal, 2 hit, 3 bfire, 5 bhit, 6 strike
    struct Heap {
        uint256[] k;
        uint256[] v;
        uint256 n;
        uint256 q;
    }

    function _push(Heap memory h, uint256 t, uint256 typ, uint256 val) internal pure {
        uint256 key = (t << 40) | (h.q++ << 8) | typ;
        uint256 i = h.n++;
        h.k[i] = key;
        h.v[i] = val;
        while (i > 0) {
            uint256 p = (i - 1) / 2;
            if (h.k[p] <= h.k[i]) break;
            (h.k[p], h.k[i]) = (h.k[i], h.k[p]);
            (h.v[p], h.v[i]) = (h.v[i], h.v[p]);
            i = p;
        }
    }

    function _pop(Heap memory h) internal pure returns (uint256 key, uint256 val) {
        key = h.k[0];
        val = h.v[0];
        h.n--;
        h.k[0] = h.k[h.n];
        h.v[0] = h.v[h.n];
        uint256 i;
        while (true) {
            uint256 l = 2 * i + 1;
            if (l >= h.n) break;
            uint256 m = l;
            if (l + 1 < h.n && h.k[l + 1] < h.k[l]) m = l + 1;
            if (h.k[i] <= h.k[m]) break;
            (h.k[m], h.k[i]) = (h.k[i], h.k[m]);
            (h.v[m], h.v[i]) = (h.v[i], h.v[m]);
            i = m;
        }
    }

    function _volleyN(uint256 w, uint256 tier) internal pure returns (uint256) {
        if (w == 0) return tier == 0 ? 4 : tier == 1 ? 6 : 9;
        if (w == 1) return tier == 2 ? 3 : 1;
        return tier == 0 ? 2 : tier == 1 ? 3 : 4;
    }

    struct Night {
        uint32 heal;
        uint256 mulP;
        uint256[3] wtier;
        uint32 rage;
        uint256 bossDmg;
        uint256 killT;
        uint256 bz;
        uint256 bzDmg;
        // events (merged shots and boss attacks), t | kind << 32 | dmg << 40 (kind 0..2 weapon, 3 boss)
        uint256[] ev;
        uint256 nev;
    }

    function _planNight(G memory g) internal pure returns (Night memory nt) {
        nt.mulP = 100 + 12 * (g.stageNo - 1);
        uint256[3] memory ammo;
        uint256 shots;
        for (uint256 i; i < 3; i++) {
            ammo[i] = g.charge[i] / 6;
            g.charge[i] -= uint32(ammo[i] * 6);
            nt.wtier[i] = _tierOf(i, ammo[i]);
            shots += ammo[i];
        }
        uint256 sp = g.charge[3];
        uint256 sh = g.shield + _rdiv(sp * _tierPct(_tierOf(3, sp)), 100) * 10; // stacks on what is left
        g.shield = uint32(sh > BASE_MAX ? BASE_MAX : sh);
        g.charge[3] = 0;
        uint256 repTier = _tierOf(4, g.charge[4] / 2);
        nt.heal = uint32(_rdiv(uint256(g.charge[4]) * _tierPct(repTier), 200) * 10); // the medics' pool
        g.charge[4] = 0;
        nt.rage = g.rage;
        nt.bz = g.bazooka;
        nt.bzDmg = _rdiv(600 * nt.mulP, 100);
        g.bazooka = 0;

        uint256 spacing;
        if (shots > 0) {
            spacing = 7000 / shots;
            if (spacing > 420) spacing = 420;
            if (spacing < 160) spacing = 160;
        }
        uint256 attacks = 4 + g.stageNo + g.rage;
        nt.ev = new uint256[](shots + attacks);
        uint256 dur = shots * spacing + 500;
        if (dur < 4500) dur = 4500;
        uint256 bossDmg = _rdiv((6 + 3 * (g.stageNo - 1)) * 10 * (4 + g.rage), 4);
        nt.bossDmg = bossDmg;
        // shots round-robin across weapons, then merge with boss attacks by time (shots first on ties)
        uint256[3] memory left = ammo;
        uint256 j;
        uint256 b;
        uint256 shotT;
        uint256 bossT = NIGHT_START + 600;
        uint256 w;
        bool moreShots = shots > 0;
        uint256 shotKind = _nextShot(left, w);
        while (j < shots || b < attacks) {
            if (moreShots && j < shots) shotT = NIGHT_START + j * spacing;
            if (b < attacks) bossT = NIGHT_START + 600 + (b * dur) / attacks;
            if (j < shots && (b >= attacks || shotT <= bossT)) {
                uint256 base_ = shotKind == 0 ? 50 : shotKind == 1 ? 80 : 26;
                uint256 dmg = _rdiv(base_ * nt.mulP * _tierPct(nt.wtier[shotKind]), 10000);
                nt.ev[nt.nev++] = shotT | (shotKind << 32) | (dmg << 40);
                left[shotKind]--;
                j++;
                w = shotKind + 1;
                if (j < shots) shotKind = _nextShot(left, w);
            } else {
                nt.ev[nt.nev++] = bossT | (uint256(3) << 32) | (bossDmg << 40);
                b++;
            }
        }
    }

    function _refund(G memory g, Night memory nt, uint256 killT) internal pure {
        for (uint256 i; i < nt.nev; i++) {
            uint256 e = nt.ev[i];
            uint256 kind = (e >> 32) & 0xff;
            if (kind < 3 && (e & 0xffffffff) > killT) g.charge[kind] += 6;
        }
    }

    function _nextShot(uint256[3] memory left, uint256 from) internal pure returns (uint256) {
        for (uint256 i; i < 3; i++) {
            uint256 w = (from + i) % 3;
            if (left[w] > 0) return w;
        }
        return 0;
    }

    function _brainStep(G memory g, uint32 hp, uint32 base, uint32 shield, uint32 rage) internal view returns (uint8) {
        uint256 bq = (uint256(hp) * 4) / g.maxHp;
        if (bq > 3) bq = 3;
        uint256 sq = (uint256(base) * 4) / BASE_MAX;
        if (sq > 3) sq = 3;
        uint256 r = rage > 3 ? 3 : rage;
        uint8 inp = uint8(bq | (sq << 2) | ((shield > 0 ? 1 : 0) << 4) | (r << 5));
        uint8 bits = g.customBrain != 0 ? g.customBits : brainStateBits[g.btype];
        bytes memory state = bits == 0 ? new bytes(0) : abi.encodePacked(g.brain);
        uint256 circuit = g.customBrain != 0 ? g.customBrain : brainIds[g.btype];
        (bytes memory ns, bytes memory out) = armory.step(circuit, state, abi.encodePacked(inp));
        g.brain = ns.length > 0 ? uint8(ns[0]) : 0;
        return uint8(out[0]) & 3;
    }

    /// @dev returns outcome 0 hold, 1 kill, 2 over
    function _runNight(G memory g, uint16[] memory strikes) internal view returns (uint8 outcome) {
        Night memory nt = _planNight(g);
        Heap memory h;
        h.k = new uint256[](1 + nt.nev * 2 + nt.bz + strikes.length * 2 + 5);
        h.v = new uint256[](h.k.length);
        uint256 nBoss;
        uint256 lastHit = NIGHT_START + 1200;
        for (uint256 i; i < nt.nev; i++) {
            uint256 e = nt.ev[i];
            uint256 t = e & 0xffffffff;
            uint256 kind = (e >> 32) & 0xff;
            uint256 dmg = e >> 40;
            if (kind == 3) {
                _push(h, t, 3, nBoss); // bfire: boss attack index
                _push(h, t + BOSS_AIM + BOSS_FLIGHT, 5, nBoss | (dmg << 16));
                if (t + BOSS_AIM + BOSS_FLIGHT > lastHit) lastHit = t + BOSS_AIM + BOSS_FLIGHT;
                nBoss++;
                continue;
            }
            uint256 tier = nt.wtier[kind];
            uint256 n = _volleyN(kind, tier);
            // one hit per volley: its total damage, landing with the first projectile
            uint256 d;
            uint256 tt;
            if (kind == 0) {
                d = n * _rdiv(dmg * 16, n * 10);
                tt = t + 160;
            } else if (kind == 1) {
                d = n > 1 ? n * _rdiv(dmg * 13, n * 10) : dmg;
                tt = t + (tier == 0 ? 700 : 500);
            } else {
                d = n * _rdiv(dmg * 3, n);
                tt = t + 750;
            }
            _push(h, tt, 2, d | (uint256(0xff) << 32)); // sid 0xff = not a bomb
            if (tt > lastHit) lastHit = tt;
        }
        for (uint256 j; j < nt.bz; j++) { // bazookas: one heavy hit each
            uint256 tb = NIGHT_START + 200 + j * 550 + 600;
            _push(h, tb, 2, nt.bzDmg | (uint256(0xff) << 32));
            if (tb > lastHit) lastHit = tb;
        }
        // onslaught: after its regular attacks, a war machine still standing unleashes its signature weapon
        {
            uint256 slamAt = lastHit + 600;
            uint256 slamDmg = _rdiv(nt.bossDmg * 6, 10);
            for (uint256 k; k < 5; k++) _push(h, slamAt + k * 160, 7, slamDmg);
        }
        uint256 bombDmg = _rdiv(160 * nt.mulP, 100);
        for (uint256 s; s < strikes.length; s++) {
            uint256 ts = strikes[s];
            _push(h, ts, 6, s);
            _push(h, ts + 530, 2, (3 * bombDmg) | (s << 32)); // all three bombs, when the first lands
        }

        uint8[] memory act = new uint8[](nBoss);
        uint256 liveStrikes;
        uint32 hp = g.hp;
        uint32 base = g.base;
        uint32 shield = g.shield;
        while (h.n > 0) {
            (uint256 key, uint256 val) = _pop(h);
            uint256 typ = key & 0xff;
            if (typ == 6) {
                if ((hp == 0) || g.strikes == 0) continue;
                g.strikes--;
                liveStrikes |= 1 << val;
            } else if (typ == 2) {
                uint256 sid = (val >> 32) & 0xff;
                if ((hp == 0) || (sid != 0xff && (liveStrikes >> sid) & 1 == 0)) continue;
                uint32 o;
                (g.crs, o) = _next(g.crs);
                uint256 d = (val & 0xffffffff) * (o < 429496730 ? 2 : 1);
                hp = d >= hp ? 0 : hp - uint32(d);
                g.score += _rdiv(d, 5);
                g.damage += d;
                if (hp == 0) nt.killT = key >> 40;
            } else if (typ == 3) {
                if ((hp == 0)) continue;
                act[val] = _brainStep(g, hp, base, shield, nt.rage);
            } else if (typ == 7) {
                if ((hp == 0)) continue;
                uint256 absorbed7 = val < shield ? val : shield;
                shield -= uint32(absorbed7);
                uint256 rest7 = val - absorbed7;
                uint256 patch7 = _rdiv(rest7 * MEDIC_PCT, 100);
                if (patch7 > nt.heal) patch7 = nt.heal;
                nt.heal -= uint32(patch7);
                rest7 -= patch7;
                base = rest7 >= base ? 0 : base - uint32(rest7);
                if (base == 0) {
                    g.base = 0;
                    g.hp = hp;
                    g.over = true;
                    return 2;
                }
            } else if (typ == 5) {
                if ((hp == 0)) continue;
                uint256 id = val & 0xffff;
                uint256 dmg = val >> 16;
                uint8 a = act[id];
                if (a == 3) {
                    uint256 nh = hp + _rdiv(uint256(g.maxHp) * 8, 100);
                    hp = uint32(nh > g.maxHp ? g.maxHp : nh);
                    continue;
                }
                uint256 rest;
                if (a == 2) {
                    shield = 0;
                    rest = _rdiv(dmg * 4, 10);
                } else {
                    uint256 dd = a == 1 ? _rdiv(dmg * 18, 10) : dmg;
                    uint256 absorbed = dd < shield ? dd : shield;
                    shield -= uint32(absorbed);
                    rest = dd - absorbed;
                }
                uint256 patch = _rdiv(rest * MEDIC_PCT, 100);
                if (patch > nt.heal) patch = nt.heal;
                nt.heal -= uint32(patch);
                rest -= patch;
                base = rest >= base ? 0 : base - uint32(rest);
                if (base == 0) {
                    g.base = 0;
                    g.hp = hp;
                    g.over = true;
                    return 2;
                }
            }
        }
        if (nt.heal > 0) { // leftover repairs: the base first, then the dome
            uint256 room = BASE_MAX - base;
            uint256 heal = nt.heal < room ? nt.heal : room;
            base += uint32(heal);
            uint256 sh2 = shield + nt.heal - heal;
            shield = uint32(sh2 > BASE_MAX ? BASE_MAX : sh2);
        }
        g.hp = hp;
        g.base = base;
        g.shield = shield;
        if ((hp == 0)) {
            _refund(g, nt, nt.killT); // unfired shots go back to the arsenal
            for (uint256 j; j < nt.bz; j++) if (NIGHT_START + 200 + j * 550 > nt.killT) g.bazooka++;
            g.score += 500 * g.stageNo;
            g.bossesDown++;
            g.stageNo++;
            g.base = g.base + 300 > BASE_MAX ? BASE_MAX : g.base + 300;
            _makeBoss(g);
            outcome = 1;
        } else {
            g.present = true;
            g.rage++;
        }
        g.moves = MOVES_PER_DAY; // the shield is kept
        if (!_findMove(g)) _shuffle(g);
    }

    // ------------------------------------------------------------------ replay
    function replay(uint32 seed, bytes calldata actions) public view returns (Result memory) {
        return _replay(seed, actions, false);
    }

    /// World Boss raid: same rules against OMEGA; Result.damage is the run's contribution.
    function replayRaid(uint32 seed, bytes calldata actions) public view returns (Result memory) {
        return _replay(seed, actions, true);
    }

    /// Boss Forge: every war machine thinks with the given Armory circuit (a player's taped-out design).
    function replayForge(uint32 seed, bytes calldata actions, uint256 circuitId) public view returns (Result memory) {
        (uint32 nIn, uint32 nOut, uint32 nState,) = armory.circuitInfo(circuitId);
        require(nIn == 7 && nOut == 2 && nState <= 8 && circuitId != 0, "brain pins");
        return _replayWith(seed, actions, false, circuitId, uint8(nState));
    }

    function _replay(uint32 seed, bytes calldata actions, bool raid) internal view returns (Result memory) {
        return _replayWith(seed, actions, raid, 0, 0);
    }

    function _replayWith(uint32 seed, bytes calldata actions, bool raid, uint256 customBrain, uint8 customBits)
        internal
        view
        returns (Result memory res)
    {
        G memory g = _newRun(seed, raid);
        g.customBrain = customBrain;
        g.customBits = customBits;
        uint256 i;
        uint256 idx;
        while (i < actions.length) {
            if (g.over) return _fail(g, idx);
            uint8 b = uint8(actions[i++]);
            if (b < 128) {
                uint256 cell = b >> 1;
                uint256 other;
                if (b & 1 == 0) {
                    if (cell % 8 == 7) return _fail(g, idx);
                    other = cell + 1;
                } else {
                    if (cell >= 56) return _fail(g, idx);
                    other = cell + 8;
                }
                (bool legal,) = _playMove(g, cell, other);
                if (!legal) return _fail(g, idx);
            } else {
                if (g.moves != 0) return _fail(g, idx);
                uint256 k = b & 0x7f;
                if (k > MAX_STRIKES || i + 2 * k > actions.length) return _fail(g, idx);
                uint16[] memory strikes = new uint16[](k);
                for (uint256 s; s < k; s++) {
                    strikes[s] = uint16(uint8(actions[i])) << 8 | uint16(uint8(actions[i + 1]));
                    i += 2;
                }
                _runNight(g, strikes);
            }
            idx++;
        }
        res = Result(true, g.over, g.score, g.stageNo, g.bossesDown, 0, g.damage);
    }

    function _fail(G memory g, uint256 idx) internal pure returns (Result memory) {
        return Result(false, g.over, g.score, g.stageNo, g.bossesDown, idx, g.damage);
    }
}
