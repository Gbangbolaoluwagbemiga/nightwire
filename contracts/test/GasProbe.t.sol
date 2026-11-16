// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test, console} from "forge-std/Test.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {ICircuits} from "../src/ITapeOut.sol";
contract GasProbe is Test {
    function test_probe() public {
        vm.createSelectFork("http://127.0.0.1:8547");
        NightwireEngine eng = new NightwireEngine(ICircuits(0xb57b56034e2dc25161e2512CfC40b24EA3bee1Fb), [uint256(1), 2, 3, 4]);
        string memory j = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures.json"));
        bytes memory a = vm.parseJsonBytes(j, ".games[1].actions");
        // gas for growing prefixes of the game
        uint256[6] memory cuts = [uint256(1), 14, 15, 40, a.length / 2, a.length];
        for (uint256 i; i < 6; i++) {
            bytes memory p = new bytes(cuts[i]);
            for (uint256 k; k < cuts[i]; k++) p[k] = a[k];
            uint256 g0 = gasleft();
            try eng.replay(uint32(vm.parseJsonUint(j, ".games[1].seed")), p) returns (NightwireEngine.Result memory) {} catch {}
            console.log("bytes", cuts[i], "gas", g0 - gasleft());
        }
    }
}
