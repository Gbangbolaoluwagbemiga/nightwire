// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IContainerOpener, ISiteRegistry, IDomainBinding, IFactoryList} from "../src/ITapeOut.sol";

/// Publishes the game to X Layer DeWEB under the container of Armory circuit #1.
/// node tools/deweb-manifest.mjs && ARMORY=<processor> forge script script/PublishDeweb.s.sol --rpc-url … --broadcast
contract PublishDeweb is Script {
    IContainerOpener constant OPENER = IContainerOpener(0x536adD8F30f03b69f6fbF29d425A816A0dC50106);
    ISiteRegistry constant SITES = ISiteRegistry(0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6);
    IDomainBinding constant BINDING = IDomainBinding(0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9);
    IFactoryList constant FACTORY = IFactoryList(0x1f09DAeFA827f02CBb40967cc91b259763760761);

    function run() external {
        address armory = vm.envAddress("ARMORY");
        uint256 circuitId = vm.envOr("CIRCUIT_ID", uint256(1));
        uint256 months = vm.envOr("MONTHS", uint256(12));
        string memory j = vm.readFile(string.concat(vm.projectRoot(), "/deweb.json"));
        uint256 n = vm.parseJsonUint(j, ".count");

        // processor number, for the on-chain name <id>.2.<processor>.tape (2 = X Layer area code)
        uint256 cpuNo = type(uint256).max;
        for (uint256 i = FACTORY.cpuCount(); i > 0; i--) {
            if (FACTORY.cpuAt(i - 1) == armory) { cpuNo = i - 1; break; }
        }
        require(cpuNo != type(uint256).max, "armory not in factory");
        address container = OPENER.accountOf(armory, circuitId);

        vm.startBroadcast();
        if (!OPENER.isDeployed(armory, circuitId)) OPENER.open{value: OPENER.FEE()}(armory, circuitId);
        for (uint256 i; i < n; i++) {
            string memory p = string.concat(".files[", vm.toString(i), "]");
            string memory path = vm.parseJsonString(j, string.concat(p, ".path"));
            bytes[] memory chunks = vm.parseJsonBytesArray(j, string.concat(p, ".chunks"));
            SITES.putFile(container, path, vm.parseJsonString(j, string.concat(p, ".contentType")), vm.parseJsonBytes32(j, string.concat(p, ".sha256")), chunks[0]);
            for (uint256 c = 1; c < chunks.length; c++) SITES.appendChunk(container, path, c, chunks[c]);
        }
        SITES.setFallback(container, "index.html");
        string memory name = string.concat(vm.toString(circuitId), ".2.", vm.toString(cpuNo), ".tape");
        BINDING.bind{value: BINDING.monthlyFee() * months}(name, container, months);
        vm.stopBroadcast();

        console.log("container", container);
        console.log("name", name);
        console.log("live", BINDING.isContainerLive(container));
        console.log(string.concat("url https://", vm.toString(circuitId), "-2-", vm.toString(cpuNo), ".tapekit.org/"));
    }
}
