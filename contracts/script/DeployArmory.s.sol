// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ITapeOutFactory, ITransistors, ICircuits, IERC20} from "../src/ITapeOut.sol";

/// Creates the "Nightwire Armory" processor on TapeOut and tapes out the four war-machine brain chips.
/// Rehearse on a fork first: anvil --fork-url https://rpc.xlayer.tech
contract DeployArmory is Script {
    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    uint256 constant SUPPLY = 1_000_000;          // transistor cap on the Armory processor
    uint256 constant PRICE = 100_000;               // 0.001 BEM per transistor, paid to the processor creator

    function run() external {
        string memory j = vm.readFile(string.concat(vm.projectRoot(), "/chips.json"));
        bytes[] memory nls = vm.parseJsonBytesArray(j, ".netlists");
        uint256[] memory nNand = vm.parseJsonUintArray(j, ".nand");
        uint256[] memory nLatch = vm.parseJsonUintArray(j, ".latch");

        vm.startBroadcast();
        IERC20 bem = IERC20(FACTORY.bem());
        console.log("BEM before", bem.balanceOf(msg.sender));
        bem.approve(address(FACTORY), FACTORY.deployFee() + FACTORY.protocolFee());
        (address t, address c) = FACTORY.createCPU(
            "Nightwire Armory", "NWARM", "War-machine brains and weapon chips for Nightwire.", SUPPLY, PRICE
        );
        ITransistors tr = ITransistors(t);
        ICircuits cpu = ICircuits(c);
        uint256 totN; uint256 totL;
        for (uint256 i; i < nls.length; i++) { totN += nNand[i]; totL += nLatch[i]; }
        bem.approve(t, PRICE * (totN + totL) + 2 * tr.protocolFee());
        tr.mint(0, totN);
        tr.mint(1, totL);
        for (uint256 i; i < nls.length; i++) {
            uint256 id = cpu.tapeout{value: cpu.TAPEOUT_FEE()}(nls[i], 7, 2);
            console.log("chip", i, "circuit id", id);
        }
        vm.stopBroadcast();
        console.log("BEM after", bem.balanceOf(msg.sender));
        console.log("transistors", t);
        console.log("processor", c);
    }
}
