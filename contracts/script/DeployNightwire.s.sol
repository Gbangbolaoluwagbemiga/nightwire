// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {NightwireLadder} from "../src/NightwireLadder.sol";
import {ICircuits} from "../src/ITapeOut.sol";

/// Deploys the on-chain engine (wired to the Armory's brain chips) and the ladder.
/// ARMORY=<processor> forge script script/DeployNightwire.s.sol --rpc-url … --broadcast
contract DeployNightwire is Script {
    function run() external {
        address armory = vm.envAddress("ARMORY");
        vm.startBroadcast();
        NightwireEngine engine = new NightwireEngine(ICircuits(armory), [uint256(1), 2, 3, 4]);
        NightwireLadder ladder = new NightwireLadder(engine);
        vm.stopBroadcast();
        console.log("engine", address(engine));
        console.log("ladder", address(ladder));
    }
}
