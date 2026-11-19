// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {NightwireLadder} from "../src/NightwireLadder.sol";
import {ICircuits} from "../src/ITapeOut.sol";

contract LadderTest is Test {
    function _ids() internal view returns (uint256[10] memory ids) {
        uint256 f = vm.envOr("BRAIN_FIRST_ID", uint256(1));
        for (uint256 i; i < 10; i++) ids[i] = f + i;
    }

    NightwireEngine eng;
    NightwireLadder ladder;
    string j;
    uint256 day;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("http://127.0.0.1:8547")));
        address armory = vm.envOr("ARMORY", address(0x804F00c9FDecBF32C38a73D6b304617D292DcE0f));
        eng = new NightwireEngine(ICircuits(armory), _ids());
        ladder = new NightwireLadder(eng);
        j = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures.json"));
        day = vm.parseJsonUint(j, ".day");
        vm.warp(day * 1 days + 3600);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);
    }

    function _run(uint256 i) internal view returns (uint32 seed, bytes memory actions, uint256 score) {
        string memory p = string.concat(".daily[", vm.toString(i), "]");
        seed = uint32(vm.parseJsonUint(j, string.concat(p, ".seed")));
        actions = vm.parseJsonBytes(j, string.concat(p, ".actions"));
        score = vm.parseJsonUint(j, string.concat(p, ".score"));
    }

    function test_dailySeedMatchesGame() public view {
        (uint32 seed,,) = _run(0);
        assertEq(ladder.dailySeed(day), seed);
    }

    function test_dailyBoardSortedAndVerified() public {
        uint256[3] memory scores;
        address[3] memory who = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            (uint32 seed, bytes memory a, uint256 sc) = _run(i);
            vm.prank(who[i]);
            assertEq(ladder.submit(day, seed, a), sc);
            scores[i] = sc;
        }
        NightwireLadder.Entry[] memory b = ladder.dailyBoard(day);
        assertEq(b.length, 3);
        assertGe(b[0].score, b[1].score);
        assertGe(b[1].score, b[2].score);
        assertTrue(b[0].player != b[1].player && b[1].player != b[2].player && b[0].player != b[2].player, "distinct players");
        uint256 total = b[0].score + b[1].score + b[2].score;
        assertEq(total, scores[0] + scores[1] + scores[2], "every submitted score is on the board once");
        assertEq(ladder.allTimeBoard().length, 3);
    }

    function test_rejectsCopiesWrongDayUnfinishedAndTampered() public {
        (uint32 seed, bytes memory a,) = _run(1);
        vm.prank(alice);
        ladder.submit(day, seed, a);
        vm.prank(bob); // copying alice's run
        vm.expectRevert(NightwireLadder.AlreadySubmitted.selector);
        ladder.submit(day, seed, a);
        vm.prank(bob); // wrong seed for the day
        vm.expectRevert(NightwireLadder.WrongDay.selector);
        ladder.submit(day, seed ^ 1, a);
        vm.warp((day + 2) * 1 days); // too late
        vm.prank(bob);
        vm.expectRevert(NightwireLadder.WrongDay.selector);
        ladder.submit(day, seed, a);
        vm.warp(day * 1 days + 3600);
        bytes memory half = vm.parseJsonBytes(j, ".daily[1].half"); // stops mid-game
        vm.prank(bob);
        vm.expectRevert(NightwireLadder.NotFinished.selector);
        ladder.submit(day, seed, half);
        bytes memory bad = bytes.concat(a); // swap the first move for an illegal one
        bad[0] = bytes1(uint8(15 * 2)); // cell 15 is the last column: "swap right" is off the board
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NightwireLadder.NotVerified.selector, 0));
        ladder.submit(day, seed, bad);
    }

    function test_onePlayerKeepsBestOnly() public {
        (uint32 seed, bytes memory a0, uint256 s0) = _run(0);
        (, bytes memory a2, uint256 s2) = _run(2);
        vm.startPrank(alice);
        ladder.submit(day, seed, a0);
        ladder.submit(day, seed, a2);
        vm.stopPrank();
        NightwireLadder.Entry[] memory b = ladder.dailyBoard(day);
        assertEq(b.length, 1);
        assertEq(b[0].score, s0 > s2 ? s0 : s2);
    }

    function test_sealedDuelWithStakes() public {
        ladder.setMaxStake(1 ether);
        (uint32 seed, bytes memory aHard, uint256 sHard) = _run(2);
        (, bytes memory aEasy, uint256 sEasy) = _run(0);
        bytes32 salt = keccak256("s");
        vm.prank(alice);
        uint256 id = ladder.openDuel{value: 0.5 ether}(seed, uint64(sHard), keccak256(abi.encodePacked(alice, seed, aHard, salt)), bob);
        vm.prank(carol); // not the named opponent
        vm.expectRevert(NightwireLadder.BadDuel.selector);
        ladder.answerDuel{value: 0.5 ether}(id, aEasy);
        vm.prank(bob);
        ladder.answerDuel{value: 0.5 ether}(id, aEasy);
        uint256 before = alice.balance;
        vm.prank(alice);
        ladder.revealDuel(id, aHard, salt);
        address expected = sHard > sEasy ? alice : bob;
        (,,,,,,,, address winner,) = ladder.duels(id);
        assertEq(winner, expected);
        if (expected == alice) assertEq(alice.balance - before, 0.95 ether);
        assertEq(ladder.feesOwed(), 0.05 ether);
    }

    function test_duelLiarForfeits() public {
        (uint32 seed, bytes memory a, uint256 s) = _run(0);
        (, bytes memory b,) = _run(1);
        bytes32 salt = bytes32(uint256(7));
        vm.prank(alice); // claims more than the run scores
        uint256 id = ladder.openDuel(seed, uint64(s + 1), keccak256(abi.encodePacked(alice, seed, a, salt)), address(0));
        vm.prank(bob);
        ladder.answerDuel(id, b);
        vm.prank(alice);
        ladder.revealDuel(id, a, salt);
        (,,,,,,,, address winner,) = ladder.duels(id);
        assertEq(winner, bob);
    }

    function test_unrevealedDuelForfeitsAndUnansweredRefunds() public {
        ladder.setMaxStake(1 ether);
        (uint32 seed,,) = _run(0);
        (, bytes memory b,) = _run(1);
        vm.prank(alice);
        uint256 id = ladder.openDuel{value: 0.2 ether}(seed, 1, bytes32(uint256(1)), address(0));
        vm.prank(bob);
        ladder.answerDuel{value: 0.2 ether}(id, b);
        vm.warp(block.timestamp + 2 days);
        uint256 before = bob.balance;
        ladder.claimForfeit(id);
        assertEq(bob.balance - before, 0.38 ether);
        vm.prank(alice);
        uint256 id2 = ladder.openDuel{value: 0.1 ether}(seed, 1, bytes32(uint256(2)), address(0));
        vm.warp(block.timestamp + 4 days);
        before = alice.balance;
        ladder.refundDuel(id2);
        assertEq(alice.balance - before, 0.1 ether);
    }

    function test_stakeCapAndPrizePool() public {
        (uint32 seed,,) = _run(0);
        vm.prank(alice);
        vm.expectRevert(NightwireLadder.StakeTooHigh.selector);
        ladder.openDuel{value: 1}(seed, 1, bytes32(0), address(0)); // stakes off by default
        vm.prank(carol);
        ladder.fundPool{value: 1 ether}(day);
        address[3] memory who = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            (uint32 s, bytes memory a,) = _run(i);
            vm.prank(who[i]);
            ladder.submit(day, s, a);
        }
        NightwireLadder.Entry[] memory b = ladder.dailyBoard(day);
        vm.prank(b[0].player);
        vm.expectRevert(NightwireLadder.WrongDay.selector); // too early
        ladder.claimPrize(day, 0);
        vm.warp((day + 2) * 1 days);
        uint256 before = b[0].player.balance;
        vm.prank(b[0].player);
        ladder.claimPrize(day, 0);
        assertEq(b[0].player.balance - before, 0.475 ether); // 50% of 95%
        vm.prank(b[1].player);
        ladder.claimPrize(day, 1);
        vm.prank(b[2].player);
        ladder.claimPrize(day, 2);
        assertEq(ladder.feesOwed(), 0.05 ether);
        assertEq(address(ladder).balance, 0.05 ether);
    }
}
