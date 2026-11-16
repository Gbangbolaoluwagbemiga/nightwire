// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NightwireEngine} from "./NightwireEngine.sol";

/// @title Nightwire Ladder: leaderboards and duels where every score is replayed on chain
/// @notice A run is (seed, actions). `submit` replays it with NightwireEngine (whose war machines think with
///         TapeOut circuits) and only records it if the game really ended with that score. Nobody, including
///         the game's own server (there is none), can post a fake score.
///         - Daily Op: one seed per UTC day for everyone; top 10 per day; optional prize pool split 50/30/20.
///         - All-time: best runs on any seed.
///         - Duels (sealed): the challenger posts a claimed score and a commitment to their moves, not the moves
///           themselves, so the opponent can't copy them. The opponent plays the same seed (verified on submit),
///           then the challenger reveals; the reveal is replayed and must reach the claimed score, or the
///           challenger forfeits. Higher verified score wins the pot. Stakes are capped and off by default.
///         - A run (seed + moves) can be recorded only once, by whoever submits it first.
contract NightwireLadder {
    NightwireEngine public immutable engine;
    address public owner;
    uint256 public maxStake; // 0 = duels without stakes only
    uint16 public constant FEE_BPS = 500; // 5% of prize pools and duel pots
    uint256 public feesOwed;
    uint256 constant TOP = 10;

    struct Entry {
        address player;
        uint64 score;
        uint32 stage;
        uint32 bossesDown;
        uint32 seed;
        uint64 at;
    }

    struct Duel {
        address challenger;
        address opponent; // 0 = open to anyone
        uint32 seed;
        uint64 claimedScore; // challenger's claim, proven at reveal
        uint64 opponentScore;
        uint128 stake; // each side
        uint64 deadline; // to answer; after an answer, to reveal
        uint8 state; // 1 open, 2 answered, 3 settled, 4 refunded
        address winner;
        bytes32 commitment; // keccak256(challenger, seed, actions, salt)
    }

    mapping(uint256 => Entry[]) internal daily; // day => sorted top list
    mapping(uint256 => uint256) public dailyPool; // day => OKB
    mapping(uint256 => mapping(uint256 => bool)) public dailyPaid; // day => rank => claimed
    Entry[] internal allTime;
    Duel[] public duels;
    mapping(bytes32 => bool) public used; // a run can be submitted once

    event RunVerified(address indexed player, uint32 indexed seed, uint256 indexed day, uint64 score, uint32 stage, uint32 bossesDown, bytes32 runHash);
    event DuelOpened(uint256 indexed id, address indexed challenger, address opponent, uint32 seed, uint64 score, uint256 stake);
    event DuelSettled(uint256 indexed id, address indexed winner, uint64 challengerScore, uint64 opponentScore, uint256 paid);
    event PoolFunded(uint256 indexed day, address indexed from, uint256 amount);
    event PrizeClaimed(uint256 indexed day, uint256 rank, address indexed player, uint256 amount);

    error NotVerified(uint256 failedAt);
    error NotFinished();
    error AlreadySubmitted();
    error WrongDay();
    error BadDuel();
    error StakeTooHigh();

    constructor(NightwireEngine engine_) {
        engine = engine_;
        owner = msg.sender;
    }

    // ------------------------------------------------------------------ seeds
    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// Same formula as the game (src/game.js dailySeed).
    function dailySeed(uint256 day) public pure returns (uint32) {
        unchecked {
            return uint32(day * 2654435761 + 0x5eed);
        }
    }

    // ------------------------------------------------------------------ runs
    function _verify(uint32 seed, bytes calldata actions) internal returns (NightwireEngine.Result memory r, bytes32 h) {
        h = keccak256(abi.encodePacked(seed, actions));
        if (used[h]) revert AlreadySubmitted(); // first submitter owns a run; copies are rejected
        used[h] = true;
        r = engine.replay(seed, actions);
        if (!r.ok) revert NotVerified(r.failedAt);
        if (!r.over) revert NotFinished();
    }

    /// Submit a finished run. day = type(uint256).max for a free-play (any seed) run.
    function submit(uint256 day, uint32 seed, bytes calldata actions) external returns (uint64 score) {
        if (day != type(uint256).max) {
            uint256 t = today();
            if (!(day == t || day + 1 == t) || seed != dailySeed(day)) revert WrongDay();
        }
        (NightwireEngine.Result memory r, bytes32 h) = _verify(seed, actions);
        score = uint64(r.score);
        Entry memory e = Entry(msg.sender, score, r.stage, r.bossesDown, seed, uint64(block.timestamp));
        if (day != type(uint256).max) _insert(daily[day], e);
        _insert(allTime, e);
        emit RunVerified(msg.sender, seed, day, score, r.stage, r.bossesDown, h);
    }

    /// keep one best entry per player, sorted by score, at most TOP long
    function _insert(Entry[] storage list, Entry memory e) internal {
        uint256 n = list.length;
        for (uint256 i; i < n; i++) {
            if (list[i].player == e.player) {
                if (list[i].score >= e.score) return;
                for (uint256 j = i; j + 1 < n; j++) list[j] = list[j + 1];
                list.pop();
                n--;
                break;
            }
        }
        if (n == TOP && list[n - 1].score >= e.score) return;
        if (n < TOP) { list.push(e); n++; } else { list[n - 1] = e; }
        for (uint256 i = n - 1; i > 0 && list[i - 1].score < list[i].score; i--) {
            (list[i - 1], list[i]) = (list[i], list[i - 1]);
        }
    }

    function dailyBoard(uint256 day) external view returns (Entry[] memory) {
        return daily[day];
    }

    function allTimeBoard() external view returns (Entry[] memory) {
        return allTime;
    }

    // ------------------------------------------------------------------ Daily Op prizes
    function fundPool(uint256 day) external payable {
        if (day < today()) revert WrongDay();
        dailyPool[day] += msg.value;
        emit PoolFunded(day, msg.sender, msg.value);
    }

    /// After the day (and its one-day submission grace) closes, ranks 1-3 claim 50/30/20 of the pool minus the fee.
    function claimPrize(uint256 day, uint256 rank) external {
        if (day + 2 > today() || rank >= 3 || dailyPaid[day][rank]) revert WrongDay();
        Entry[] storage list = daily[day];
        if (rank >= list.length || list[rank].player != msg.sender) revert BadDuel();
        dailyPaid[day][rank] = true;
        uint256 pool = dailyPool[day];
        uint256 net = pool - (pool * FEE_BPS) / 10_000;
        uint256 amount = (net * [uint256(50), 30, 20][rank]) / 100;
        feesOwed += ((pool - net) * [uint256(50), 30, 20][rank]) / 100;
        _pay(msg.sender, amount);
        emit PrizeClaimed(day, rank, msg.sender, amount);
    }

    /// Prizes nobody can claim (fewer than 3 players) roll into today's pool after a week.
    function rollover(uint256 day) external {
        if (day + 7 > today()) revert WrongDay();
        Entry[] storage list = daily[day];
        uint256 pool = dailyPool[day];
        uint256 moved;
        for (uint256 rank; rank < 3; rank++) {
            if (dailyPaid[day][rank]) continue;
            dailyPaid[day][rank] = true;
            moved += (pool * [uint256(50), 30, 20][rank]) / 100; // unclaimed (or no such rank) after a week
        }
        list; // board stays as history
        dailyPool[today()] += moved;
        emit PoolFunded(today(), address(this), moved);
    }

    // ------------------------------------------------------------------ duels
    /// Open a sealed duel: commitment = keccak256(abi.encodePacked(msg.sender, seed, actions, salt)).
    function openDuel(uint32 seed, uint64 claimedScore, bytes32 commitment, address opponent) external payable returns (uint256 id) {
        if (msg.value > maxStake) revert StakeTooHigh();
        id = duels.length;
        duels.push(Duel(msg.sender, opponent, seed, claimedScore, 0, uint128(msg.value), uint64(block.timestamp + 3 days), 1, address(0), commitment));
        emit DuelOpened(id, msg.sender, opponent, seed, claimedScore, msg.value);
    }

    /// The opponent plays the same seed; their run is verified now.
    function answerDuel(uint256 id, bytes calldata actions) external payable {
        Duel storage d = duels[id];
        if (d.state != 1 || block.timestamp > d.deadline || msg.sender == d.challenger) revert BadDuel();
        if (d.opponent != address(0) && d.opponent != msg.sender) revert BadDuel();
        if (msg.value != d.stake) revert BadDuel();
        (NightwireEngine.Result memory r, bytes32 h) = _verify(d.seed, actions);
        emit RunVerified(msg.sender, d.seed, type(uint256).max, uint64(r.score), r.stage, r.bossesDown, h);
        d.opponent = msg.sender;
        d.opponentScore = uint64(r.score);
        d.state = 2;
        d.deadline = uint64(block.timestamp + 1 days);
    }

    /// The challenger reveals; their run is replayed and must match the commitment and the claimed score.
    function revealDuel(uint256 id, bytes calldata actions, bytes32 salt) external {
        Duel storage d = duels[id];
        if (d.state != 2 || msg.sender != d.challenger) revert BadDuel();
        if (keccak256(abi.encodePacked(msg.sender, d.seed, actions, salt)) != d.commitment) revert BadDuel();
        (NightwireEngine.Result memory r, bytes32 h) = _verify(d.seed, actions);
        emit RunVerified(msg.sender, d.seed, type(uint256).max, uint64(r.score), r.stage, r.bossesDown, h);
        if (r.score != d.claimedScore) { _settle(id, d.opponent); return; } // claimed more than they scored
        if (r.score == d.opponentScore) { _settle(id, address(0)); return; }
        _settle(id, r.score > d.opponentScore ? d.challenger : d.opponent);
    }

    /// Challenger never revealed: the opponent wins.
    function claimForfeit(uint256 id) external {
        Duel storage d = duels[id];
        if (d.state != 2 || block.timestamp <= d.deadline) revert BadDuel();
        _settle(id, d.opponent);
    }

    /// Unanswered after the deadline: the challenger takes the stake back.
    function refundDuel(uint256 id) external {
        Duel storage d = duels[id];
        if (d.state != 1 || block.timestamp <= d.deadline) revert BadDuel();
        d.state = 4;
        _pay(d.challenger, d.stake);
    }

    function _settle(uint256 id, address winner) internal {
        Duel storage d = duels[id];
        d.state = 3;
        d.winner = winner;
        uint256 pot = uint256(d.stake) * 2;
        if (winner == address(0)) { // draw: both refunded, no fee
            _pay(d.challenger, d.stake);
            _pay(d.opponent, d.stake);
            emit DuelSettled(id, address(0), d.claimedScore, d.opponentScore, 0);
            return;
        }
        uint256 fee = (pot * FEE_BPS) / 10_000;
        feesOwed += fee;
        _pay(winner, pot - fee);
        emit DuelSettled(id, winner, d.claimedScore, d.opponentScore, pot - fee);
    }

    function duelCount() external view returns (uint256) {
        return duels.length;
    }

    // ------------------------------------------------------------------ admin
    function setMaxStake(uint256 v) external {
        require(msg.sender == owner, "owner");
        maxStake = v;
    }

    function withdrawFees(address to) external {
        require(msg.sender == owner, "owner");
        uint256 v = feesOwed;
        feesOwed = 0;
        _pay(to, v);
    }

    function transferOwnership(address to) external {
        require(msg.sender == owner, "owner");
        owner = to;
    }

    function _pay(address to, uint256 v) internal {
        if (v == 0) return;
        (bool ok,) = to.call{value: v}("");
        require(ok, "pay");
    }
}
