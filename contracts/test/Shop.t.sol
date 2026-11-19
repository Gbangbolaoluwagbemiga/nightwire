// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {NightwireShop} from "../src/NightwireShop.sol";
import {ICircuits} from "../src/ITapeOut.sol";
import {ITransistorsOkb} from "../src/NightwireShop.sol";

interface IOwnerOf { function ownerOf(uint256) external view returns (address); function transistors() external view returns (address); }

contract ShopTest is Test {
    ICircuits armory;
    NightwireShop shop;
    NightwireEngine eng;
    string j;
    address buyer = makeAddr("buyer");

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("http://127.0.0.1:8547")));
        armory = ICircuits(vm.envOr("BRAINS_PROCESSOR", address(0x7335a50819d44402e3D5E00239bBB80A13E7308F))); // OKB-priced, free transistors
        address tr = IOwnerOf(address(armory)).transistors();
        shop = new NightwireShop(armory, ITransistorsOkb(tr), 0.005 ether);
        eng = new NightwireEngine(armory, brainIds());
        j = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures.json"));
        vm.deal(buyer, 1 ether);
    }

    /// the 9 built-in brains, taped out on the same processor by script/DeployBrains.s.sol (ids from the env)
    function brainIds() internal view returns (uint256[10] memory ids) {
        uint256 first = vm.envOr("BRAIN_FIRST_ID", uint256(0));
        require(first != 0, "set BRAIN_FIRST_ID to the first brain circuit id");
        for (uint256 i; i < 10; i++) ids[i] = first + i;
    }

    function test_cosmeticsOneTapAndOwned() public {
        shop.setPrice(1, 0.002 ether);
        vm.prank(buyer);
        vm.expectRevert(NightwireShop.WrongPrice.selector);
        shop.buy{value: 0.001 ether}(1);
        vm.prank(buyer);
        shop.buy{value: 0.002 ether}(1);
        vm.prank(buyer);
        vm.expectRevert(NightwireShop.AlreadyOwned.selector);
        shop.buy{value: 0.002 ether}(1);
        uint256[] memory items = new uint256[](2);
        items[0] = 1; items[1] = 2;
        bool[] memory o = shop.ownedOf(buyer, items);
        assertTrue(o[0] && !o[1]);
        vm.expectRevert(NightwireShop.WrongPrice.selector); // not for sale
        shop.buy{value: 0}(2);
    }

    function test_tapeOutMachineAndVerifyFightsOnChain() public {
        uint256 n = vm.parseJsonUint(j, ".forgeCount");
        uint256 lastDesign = type(uint256).max;
        uint256 id;
        for (uint256 i; i < n; i++) {
            string memory p = string.concat(".forge[", vm.toString(i), "]");
            uint256 d = vm.parseJsonUint(j, string.concat(p, ".design"));
            bytes memory nl = vm.parseJsonBytes(j, string.concat(p, ".netlist"));
            if (d != lastDesign) { // the player buys the tape-out of their design
                vm.prank(buyer);
                id = shop.tapeOutMachine{value: 0.005 ether}(nl, keccak256(nl));
                assertEq(IOwnerOf(address(armory)).ownerOf(id), buyer, "circuit NFT goes to the player");
                assertEq(armory.netlist(id), nl, "the exact compiled netlist is on chain");
                console.log("design", d, "circuit", id);
                lastDesign = d;
            }
            NightwireEngine.Result memory r = eng.replayForge(uint32(vm.parseJsonUint(j, string.concat(p, ".seed"))), vm.parseJsonBytes(j, string.concat(p, ".actions")), id);
            assertTrue(r.ok && r.over, "forge replay");
            assertEq(r.score, vm.parseJsonUint(j, string.concat(p, ".score")), string.concat("forge score ", vm.toString(i)));
        }
        assertEq(shop.machinesOwnedBy(buyer).length, 3);
        assertGt(address(shop).balance, 0, "shop keeps the margin");
        console.log("shop margin after 3 machines (wei)", address(shop).balance);
    }

    function test_rejectsRefNetlists() public {
        bytes memory refNl = hex"0200000000000000000000000000000000000000aa000000000000000101010000020000030000";
        vm.prank(buyer);
        vm.expectRevert(NightwireShop.BadNetlist.selector);
        shop.tapeOutMachine{value: 0.005 ether}(refNl, bytes32(0));
    }
}
