// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {ICircuits} from "../src/ITapeOut.sol";

/// Differential test: every game played by the JS engine (tools/fixtures.mjs) must replay on chain to the
/// identical score. Runs against a fork that has the Armory processor (set ARMORY, default: local rehearsal).
contract EngineDiffTest is Test {
    function _ids() internal view returns (uint256[10] memory ids) {
        uint256 f = vm.envOr("BRAIN_FIRST_ID", uint256(1));
        for (uint256 i; i < 10; i++) ids[i] = f + i;
    }

    NightwireEngine eng;

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("http://127.0.0.1:8547")));
        address armory = vm.envOr("ARMORY", address(0x804F00c9FDecBF32C38a73D6b304617D292DcE0f));
        eng = new NightwireEngine(ICircuits(armory), _ids());
    }

    function test_replayMatchesJs() public view {
        string memory j = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures.json"));
        uint256 n = vm.envOr("GAMES", vm.parseJsonUint(j, ".count"));
        uint256 maxGas;
        for (uint256 i; i < n; i++) {
            string memory p = string.concat(".games[", vm.toString(i), "]");
            uint32 seed = uint32(vm.parseJsonUint(j, string.concat(p, ".seed")));
            bytes memory actions = vm.parseJsonBytes(j, string.concat(p, ".actions"));
            uint256 g0 = gasleft();
            NightwireEngine.Result memory r = eng.replay(seed, actions);
            uint256 used = g0 - gasleft();
            if (used > maxGas) maxGas = used;
            assertTrue(r.ok, string.concat("replay failed, game ", vm.toString(i)));
            assertEq(r.score, vm.parseJsonUint(j, string.concat(p, ".score")), string.concat("score, game ", vm.toString(i)));
            assertEq(r.stage, vm.parseJsonUint(j, string.concat(p, ".stage")), "stage");
            assertEq(r.bossesDown, vm.parseJsonUint(j, string.concat(p, ".bossesDown")), "bosses");
            assertEq(r.over, vm.parseJsonBool(j, string.concat(p, ".over")), "over");
        }
        console.log("games", n, "max gas", maxGas);
    }
}
