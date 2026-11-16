// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ICircuits} from "../src/ITapeOut.sol";

interface ITransistorsOkb {
    function mint(uint256 id, uint256 amount) external payable; // older processors: paid in OKB
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
}
interface IHasTransistors { function transistors() external view returns (address); }

/// Low-cost path: tape out the 9 brain chips on an existing TapeOut processor whose transistors are
/// priced in OKB (the FAQ allows using existing processors). No BEM, no processor of our own.
/// PROCESSOR=<address> forge script script/DeployBrains.s.sol --rpc-url … --broadcast
contract DeployBrains is Script {
    function run() external {
        ICircuits cpu = ICircuits(vm.envAddress("PROCESSOR"));
        ITransistorsOkb tr = ITransistorsOkb(IHasTransistors(address(cpu)).transistors());
        string memory j = vm.readFile(string.concat(vm.projectRoot(), "/chips.json"));
        bytes[] memory nls = vm.parseJsonBytesArray(j, ".netlists");
        uint256[] memory nNand = vm.parseJsonUintArray(j, ".nand");
        uint256[] memory nLatch = vm.parseJsonUintArray(j, ".latch");
        uint256 totN;
        uint256 totL;
        for (uint256 i; i < nls.length; i++) { totN += nNand[i]; totL += nLatch[i]; }
        uint256 p = tr.mintPrice();
        uint256 pf = tr.protocolFee();
        uint256 balBefore = msg.sender.balance;
        vm.startBroadcast();
        tr.mint{value: p * totN + pf}(0, totN);
        tr.mint{value: p * totL + pf}(1, totL);
        for (uint256 i; i < nls.length; i++) {
            uint256 id = cpu.tapeout{value: cpu.TAPEOUT_FEE()}(nls[i], 7, 2);
            console.log("brain", i, "circuit id", id);
        }
        vm.stopBroadcast();
        console.log("processor", address(cpu));
        console.log("OKB spent (wei, excl. gas)", balBefore - msg.sender.balance);
    }
}
