// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test, console} from "forge-std/Test.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {ICircuits} from "../src/ITapeOut.sol";
contract Prof is NightwireEngine {
    constructor(ICircuits a) NightwireEngine(a, [uint256(1), 2, 3, 4, 5, 6, 7, 8]) {}
    function profile(uint32 seed, bytes calldata actions) external view returns (uint256 setup, uint256 moves, uint256 nMoves, uint256 nights, uint256 nNights, uint256 maxMove, uint256 shuffles) {
        uint256 g0 = gasleft();
        G memory g = _newRun(seed);
        setup = g0 - gasleft();
        uint256 i;
        while (i < actions.length) {
            uint8 b = uint8(actions[i++]);
            g0 = gasleft();
            if (b < 128) {
                uint256 cell = b >> 1;
                uint256 other = b & 1 == 0 ? cell + 1 : cell + 8;
                uint32 rs0 = g.rs;
                _playMove(g, cell, other);
                uint256 u = g0 - gasleft();
                moves += u; nMoves++;
                if (u > maxMove) maxMove = u;
                if (u > 900000) shuffles++;
                rs0;
            } else {
                uint256 k = b & 0x7f;
                uint16[] memory st = new uint16[](k);
                for (uint256 s; s < k; s++) { st[s] = uint16(uint8(actions[i])) << 8 | uint16(uint8(actions[i + 1])); i += 2; }
                _runNight(g, st);
                nights += g0 - gasleft(); nNights++;
            }
        }
    }
}
contract Profile is Test {
    function test_profile() public {
        vm.createSelectFork("http://127.0.0.1:8547");
        Prof p = new Prof(ICircuits(0x1900801e311184063b9d9C119C9D98AA4950E12c));
        string memory j = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures.json"));
        for (uint256 gi; gi < 6; gi++) {
            string memory q = string.concat(".games[", vm.toString(gi * 9), "]");
            (uint256 setup, uint256 moves, uint256 nM, uint256 nights, uint256 nN, uint256 maxMove, uint256 sh) = p.profile(uint32(vm.parseJsonUint(j, string.concat(q, ".seed"))), vm.parseJsonBytes(j, string.concat(q, ".actions")));
            console.log("game", gi * 9);
            console.log("  setup", setup, "moves avg", moves / nM);
            console.log("  nights avg", nights / nN, "nights", nN);
            console.log("  total moves", moves, "max move", maxMove);
            console.log("  total nights", nights, "heavy moves", sh);
        }
    }
}
