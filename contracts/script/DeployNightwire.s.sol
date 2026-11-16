// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {NightwireLadder} from "../src/NightwireLadder.sol";
import {NightwireRaid} from "../src/NightwireRaid.sol";
import {NightwireShop, ITransistorsOkb} from "../src/NightwireShop.sol";
import {ICircuits} from "../src/ITapeOut.sol";

interface IHasTransistors { function transistors() external view returns (address); }

/// Deploys the on-chain engine (wired to the 9 brain chips), the ladder, the raid and the shop.
/// BRAINS_PROCESSOR=<processor> BRAIN_FIRST_ID=<id of brain #0> forge script script/DeployNightwire.s.sol --rpc-url … --broadcast
contract DeployNightwire is Script {
    function run() external {
        address cpu = vm.envAddress("BRAINS_PROCESSOR");
        uint256 first = vm.envUint("BRAIN_FIRST_ID");
        uint256[9] memory ids;
        for (uint256 i; i < 9; i++) ids[i] = first + i;
        vm.startBroadcast();
        NightwireEngine engine = new NightwireEngine(ICircuits(cpu), ids);
        NightwireLadder ladder = new NightwireLadder(engine);
        NightwireRaid raid = new NightwireRaid(engine, 1_500_000); // OMEGA: 150,000 HP a week
        NightwireShop shop = new NightwireShop(ICircuits(cpu), ITransistorsOkb(IHasTransistors(cpu).transistors()), 0.005 ether);
        uint256[6] memory items = [uint256(1), 2, 3, 11, 12, 13]; // cosmetics (src/shop.js)
        for (uint256 i; i < items.length; i++) shop.setPrice(items[i], 0.002 ether);
        vm.stopBroadcast();
        console.log("engine", address(engine));
        console.log("ladder", address(ladder));
        console.log("raid", address(raid));
        console.log("shop", address(shop));
    }
}
