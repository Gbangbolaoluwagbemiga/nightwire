// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test, console} from "forge-std/Test.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {ICircuits} from "../src/ITapeOut.sol";
contract Harness is NightwireEngine {
    constructor(ICircuits a) NightwireEngine(a, [uint256(1), 2, 3, 4, 5, 6, 7, 8, 9, 10]) {}
    function probe(uint32 seed) external view returns (uint256[8] memory gs) {
        uint256 g0 = gasleft();
        G memory g = _newRun(seed, false);
        gs[0] = g0 - gasleft(); g0 = gasleft();
        _findMove(g); gs[1] = g0 - gasleft(); g0 = gasleft();
        (uint256[] memory runs, uint256 nr) = _findRuns(g); gs[2] = g0 - gasleft(); g0 = gasleft();
        _dropAndRefill(g, 0x0000000000ff00ff); gs[3] = g0 - gasleft(); g0 = gasleft();
        Creates memory cr;
        _applyClear(g, 0x00000000000000ff, cr); gs[4] = g0 - gasleft(); g0 = gasleft();
        _shuffle(g); gs[5] = g0 - gasleft(); g0 = gasleft();
        _mask(g.c, 2); gs[6] = g0 - gasleft(); g0 = gasleft();
        _r5(g); gs[7] = g0 - gasleft();
        nr; runs;
    }
}
contract FnGas is Test {
    function test_fn() public {
        vm.createSelectFork("http://127.0.0.1:8547");
        Harness h = new Harness(ICircuits(0x804F00c9FDecBF32C38a73D6b304617D292DcE0f));
        uint256[8] memory gs = h.probe(12345);
        string[8] memory nm = ["newRun", "findMove", "findRuns", "dropRefill(16)", "applyClear(8)", "shuffle", "mask", "r5"];
        for (uint256 i; i < 8; i++) console.log(nm[i], gs[i]);
    }
}
