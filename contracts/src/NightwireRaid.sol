// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NightwireEngine} from "./NightwireEngine.sol";

/// @title Nightwire Raid: one World Boss a week, fought by everyone
/// @notice OMEGA has a shared health pool for the week. Every submitted run is replayed on chain by
///         NightwireEngine (OMEGA's brain is a TapeOut circuit like every war machine's) and the damage it
///         dealt comes off the pool. Contributions add up per player; when the pool reaches zero OMEGA is down,
///         and after the week the top 3 contributors share the week's prize pool 50/30/20 (5% fee).
///         If OMEGA survives the week, its prize pool rolls into the next week.
contract NightwireRaid {
    NightwireEngine public immutable engine;
    address public owner;
    uint256 public poolHp; // tenths of HP per week
    uint16 public constant FEE_BPS = 500;
    uint256 public feesOwed;
    uint256 constant TOP = 10;

    struct Contributor {
        address player;
        uint128 damage; // tenths
        uint64 runs;
    }

    mapping(uint256 => uint256) public dealt; // week => damage
    mapping(uint256 => uint64) public downAt; // week => timestamp OMEGA fell (0 = standing)
    mapping(uint256 => mapping(address => uint256)) public contributionOf;
    mapping(uint256 => mapping(address => uint64)) public runsOf;
    mapping(uint256 => Contributor[]) internal tops;
    mapping(uint256 => uint256) public prizePool;
    mapping(uint256 => mapping(uint256 => bool)) public paid;
    mapping(bytes32 => bool) public used;

    event RaidRun(uint256 indexed week, address indexed player, uint256 damage, uint256 dealt, bytes32 runHash);
    event OmegaDown(uint256 indexed week, address indexed finalBlow, uint256 at);
    event PoolFunded(uint256 indexed week, address indexed from, uint256 amount);
    event PrizeClaimed(uint256 indexed week, uint256 rank, address indexed player, uint256 amount);

    error WrongWeek();
    error NotVerified(uint256 failedAt);
    error NotFinished();
    error AlreadySubmitted();
    error NotYours();

    constructor(NightwireEngine engine_, uint256 poolHp_) {
        engine = engine_;
        owner = msg.sender;
        poolHp = poolHp_;
    }

    function week() public view returns (uint256) {
        return block.timestamp / 7 days;
    }

    /// Same formula as the game (src/engine.js raidSeed).
    function raidSeed(uint256 w) public pure returns (uint32) {
        unchecked {
            return uint32(w * 2246822519 + 0x0bade5);
        }
    }

    function submit(uint256 w, bytes calldata actions) external returns (uint256 damage) {
        if (w != week()) revert WrongWeek();
        uint32 seed = raidSeed(w);
        bytes32 h = keccak256(abi.encodePacked(seed, actions));
        if (used[h]) revert AlreadySubmitted();
        used[h] = true;
        NightwireEngine.Result memory r = engine.replayRaid(seed, actions);
        if (!r.ok) revert NotVerified(r.failedAt);
        if (!r.over) revert NotFinished();
        damage = r.damage;
        bool standing = downAt[w] == 0;
        dealt[w] += damage;
        uint256 total = contributionOf[w][msg.sender] + damage;
        contributionOf[w][msg.sender] = total;
        runsOf[w][msg.sender]++;
        _rank(tops[w], msg.sender, total, runsOf[w][msg.sender]);
        emit RaidRun(w, msg.sender, damage, dealt[w], h);
        if (standing && dealt[w] >= poolHp) {
            downAt[w] = uint64(block.timestamp);
            emit OmegaDown(w, msg.sender, block.timestamp);
        }
    }

    function _rank(Contributor[] storage list, address p, uint256 total, uint64 runs) internal {
        uint256 n = list.length;
        uint256 i = n;
        for (uint256 j; j < n; j++) if (list[j].player == p) { i = j; break; }
        if (i == n) {
            if (n == TOP && list[n - 1].damage >= total) return;
            if (n < TOP) { list.push(); n++; }
            i = n - 1;
        }
        list[i] = Contributor(p, uint128(total), runs);
        while (i > 0 && list[i - 1].damage < list[i].damage) {
            Contributor memory tmp = list[i - 1]; // a tuple swap of storage structs would duplicate one of them
            list[i - 1] = list[i];
            list[i] = tmp;
            i--;
        }
    }

    function topContributors(uint256 w) external view returns (Contributor[] memory) {
        return tops[w];
    }

    // ------------------------------------------------------------------ prizes
    function fundPool(uint256 w) external payable {
        if (w < week()) revert WrongWeek();
        prizePool[w] += msg.value;
        emit PoolFunded(w, msg.sender, msg.value);
    }

    /// After the week, if OMEGA fell, the top 3 contributors claim 50/30/20 of the pool minus the fee.
    function claimPrize(uint256 w, uint256 rank) external {
        if (w >= week() || downAt[w] == 0 || rank >= 3 || paid[w][rank]) revert WrongWeek();
        Contributor[] storage list = tops[w];
        if (rank >= list.length || list[rank].player != msg.sender) revert NotYours();
        paid[w][rank] = true;
        uint256 pool = prizePool[w];
        uint256 share = [uint256(50), 30, 20][rank];
        uint256 net = pool - (pool * FEE_BPS) / 10_000;
        feesOwed += ((pool - net) * share) / 100;
        _pay(msg.sender, (net * share) / 100);
        emit PrizeClaimed(w, rank, msg.sender, (net * share) / 100);
    }

    /// OMEGA survived the week (or prizes went unclaimed for 4 weeks): the pool rolls into the current week.
    function rollover(uint256 w) external {
        uint256 now_ = week();
        if (w >= now_ || (downAt[w] != 0 && w + 4 > now_)) revert WrongWeek();
        uint256 moved;
        for (uint256 rank; rank < 3; rank++) {
            if (paid[w][rank]) continue;
            paid[w][rank] = true;
            moved += (prizePool[w] * [uint256(50), 30, 20][rank]) / 100;
        }
        prizePool[now_] += moved;
        emit PoolFunded(now_, address(this), moved);
    }

    // ------------------------------------------------------------------ admin
    function setPoolHp(uint256 v) external {
        require(msg.sender == owner, "owner");
        poolHp = v; // takes effect for weeks not yet down
    }

    function withdrawFees(address to) external {
        require(msg.sender == owner, "owner");
        uint256 v = feesOwed;
        feesOwed = 0;
        _pay(to, v);
    }

    function _pay(address to, uint256 v) internal {
        if (v == 0) return;
        (bool ok,) = to.call{value: v}("");
        require(ok, "pay");
    }
}
