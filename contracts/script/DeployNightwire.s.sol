// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {NightwireLadder} from "../src/NightwireLadder.sol";
import {NightwireRaid} from "../src/NightwireRaid.sol";
import {NightwireShop} from "../src/NightwireShop.sol";
import {ITransistors, IERC20} from "../src/ITapeOut.sol";

interface IArmoryTransistors { function transistors() external view returns (address); }
import {ICircuits} from "../src/ITapeOut.sol";

/// Deploys the on-chain engine (wired to the Armory's brain chips) and the ladder.
/// ARMORY=<processor> forge script script/DeployNightwire.s.sol --rpc-url … --broadcast
contract DeployNightwire is Script {
    function run() external {
        address armory = vm.envAddress("ARMORY");
        vm.startBroadcast();
        NightwireEngine engine = new NightwireEngine(ICircuits(armory), [uint256(1), 2, 3, 4, 5, 6, 7, 8, 9]);
        NightwireLadder ladder = new NightwireLadder(engine);
        NightwireRaid raid = new NightwireRaid(engine, 1_500_000); // OMEGA: 150,000 HP a week
        NightwireShop shop = new NightwireShop(
            ICircuits(armory), ITransistors(IArmoryTransistors(armory).transistors()), IERC20(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952), 0.005 ether
        );
        // cosmetics (src/shop.js): base camouflage 1-3, tracer colours 11-13
        uint256[6] memory items = [uint256(1), 2, 3, 11, 12, 13];
        for (uint256 i; i < items.length; i++) shop.setPrice(items[i], 0.002 ether);
        vm.stopBroadcast();
        console.log("shop", address(shop));
        console.log("raid", address(raid));
        console.log("engine", address(engine));
        console.log("ladder", address(ladder));
    }
}
