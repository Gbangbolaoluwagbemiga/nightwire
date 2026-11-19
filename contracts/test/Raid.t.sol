// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {NightwireRaid} from "../src/NightwireRaid.sol";
import {ICircuits} from "../src/ITapeOut.sol";

contract RaidTest is Test {
    function _ids() internal view returns (uint256[10] memory ids) {
        uint256 f = vm.envOr("BRAIN_FIRST_ID", uint256(1));
        for (uint256 i; i < 10; i++) ids[i] = f + i;
    }

    NightwireEngine eng;
    NightwireRaid raid;
    string j;
    uint256 wk;

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("http://127.0.0.1:8547")));
        address armory = vm.envOr("ARMORY", address(0x804F00c9FDecBF32C38a73D6b304617D292DcE0f));
        eng = new NightwireEngine(ICircuits(armory), _ids());
        j = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures.json"));
        wk = vm.parseJsonUint(j, ".week");
        raid = new NightwireRaid(eng, 15_000); // a small pool so the test can bring OMEGA down
        vm.warp(wk * 7 days + 3600);
    }

    function _run(uint256 i) internal view returns (uint32 seed, bytes memory a, uint256 dmg) {
        string memory p = string.concat(".raid[", vm.toString(i), "]");
        seed = uint32(vm.parseJsonUint(j, string.concat(p, ".seed")));
        a = vm.parseJsonBytes(j, string.concat(p, ".actions"));
        dmg = vm.parseJsonUint(j, string.concat(p, ".damage"));
    }

    function test_raidReplayMatchesJs() public view {
        uint256 n = vm.parseJsonUint(j, ".raidCount");
        uint256 maxGas;
        for (uint256 i; i < n; i++) {
            (uint32 seed, bytes memory a, uint256 dmg) = _run(i);
            uint256 g0 = gasleft();
            NightwireEngine.Result memory r = eng.replayRaid(seed, a);
            if (g0 - gasleft() > maxGas) maxGas = g0 - gasleft();
            assertTrue(r.ok && r.over, "raid replay");
            assertEq(r.damage, dmg, string.concat("damage, raid ", vm.toString(i)));
            assertEq(r.score, vm.parseJsonUint(j, string.concat(".raid[", vm.toString(i), "].score")), "score");
        }
        console.log("raid runs", n, "max gas", maxGas);
    }

    function test_seedMatchesGame() public view {
        (uint32 seed,,) = _run(0);
        assertEq(raid.raidSeed(wk), seed);
    }

    function test_sharedPoolTopListAndPrizes() public {
        address[3] memory who = [makeAddr("a"), makeAddr("b"), makeAddr("c")];
        vm.deal(address(this), 3 ether);
        raid.fundPool{value: 1 ether}(wk);
        uint256 sum;
        for (uint256 i; i < 6; i++) {
            (, bytes memory a, uint256 dmg) = _run(i);
            vm.prank(who[i % 3]);
            assertEq(raid.submit(wk, a), dmg);
            sum += dmg;
        }
        assertEq(raid.dealt(wk), sum);
        NightwireRaid.Contributor[] memory top = raid.topContributors(wk);
        assertEq(top.length, 3);
        assertGe(top[0].damage, top[1].damage);
        assertGe(top[1].damage, top[2].damage);
        assertEq(top[0].runs, 2);
        assertTrue(top[0].player != top[1].player && top[1].player != top[2].player && top[0].player != top[2].player, "distinct");
        assertEq(uint256(top[0].damage) + top[1].damage + top[2].damage, sum, "all damage accounted once");
        assertTrue(raid.downAt(wk) != 0, "OMEGA should be down with a 1,500 HP pool");
        (, bytes memory a0,) = _run(0); // copies are rejected
        vm.prank(who[1]);
        vm.expectRevert(NightwireRaid.AlreadySubmitted.selector);
        raid.submit(wk, a0);
        vm.expectRevert(NightwireRaid.WrongWeek.selector); // too early to claim
        raid.claimPrize(wk, 0);
        vm.warp((wk + 1) * 7 days + 10);
        uint256 before = top[0].player.balance;
        vm.prank(top[0].player);
        raid.claimPrize(wk, 0);
        assertEq(top[0].player.balance - before, 0.475 ether);
    }

    function test_survivedWeekRollsOver() public {
        raid.setPoolHp(type(uint128).max);
        vm.deal(address(this), 1 ether);
        raid.fundPool{value: 1 ether}(wk);
        (, bytes memory a,) = _run(1);
        raid.submit(wk, a);
        vm.warp((wk + 1) * 7 days + 10);
        vm.expectRevert(NightwireRaid.WrongWeek.selector);
        raid.claimPrize(wk, 0);
        raid.rollover(wk);
        assertEq(raid.prizePool(wk + 1), 1 ether);
    }
}
