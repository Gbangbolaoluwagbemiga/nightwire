// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {NightwireEngine} from "../src/NightwireEngine.sol";
import {NightwireShop} from "../src/NightwireShop.sol";
import {ICircuits, ITransistors, IERC20} from "../src/ITapeOut.sol";

interface IOwnerOf { function ownerOf(uint256) external view returns (address); function transistors() external view returns (address); }

contract ShopTest is Test {
    ICircuits armory;
    NightwireShop shop;
    NightwireEngine eng;
    string j;
    address buyer = makeAddr("buyer");
    IERC20 constant BEM = IERC20(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952);

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("http://127.0.0.1:8547")));
        armory = ICircuits(vm.envOr("ARMORY", address(0x804F00c9FDecBF32C38a73D6b304617D292DcE0f)));
        address tr = IOwnerOf(address(armory)).transistors();
        shop = new NightwireShop(armory, ITransistors(tr), BEM, 0.005 ether);
        vm.prank(0x571d447f4f24688eC35Ccf07f1D6993655F6aF15); // fork only: BEM for the shop's transistor stock
        BEM.transfer(address(shop), 200_000_000); // 2 BEM
        eng = new NightwireEngine(armory, [uint256(1), 2, 3, 4, 5, 6, 7, 8, 9]);
        j = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures.json"));
        vm.deal(buyer, 1 ether);
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
                uint256 before = BEM.balanceOf(address(shop));
                vm.prank(buyer);
                id = shop.tapeOutMachine{value: 0.005 ether}(nl, keccak256(nl));
                assertEq(IOwnerOf(address(armory)).ownerOf(id), buyer, "circuit NFT goes to the player");
                assertEq(armory.netlist(id), nl, "the exact compiled netlist is on chain");
                console.log("design", d, "circuit", id);
                console.log("BEM spent", before - BEM.balanceOf(address(shop)));
                lastDesign = d;
            }
            NightwireEngine.Result memory r = eng.replayForge(uint32(vm.parseJsonUint(j, string.concat(p, ".seed"))), vm.parseJsonBytes(j, string.concat(p, ".actions")), id);
            assertTrue(r.ok && r.over, "forge replay");
            assertEq(r.score, vm.parseJsonUint(j, string.concat(p, ".score")), string.concat("forge score ", vm.toString(i)));
        }
        assertEq(shop.machinesOwnedBy(buyer).length, 3);
        assertEq(address(shop).balance, 3 * (0.005 ether - armory.TAPEOUT_FEE()), "shop keeps the margin");
    }

    function test_rejectsRefNetlists() public {
        bytes memory refNl = hex"0200000000000000000000000000000000000000aa000000000000000101010000020000030000";
        vm.prank(buyer);
        vm.expectRevert(NightwireShop.BadNetlist.selector);
        shop.tapeOutMachine{value: 0.005 ether}(refNl, bytes32(0));
    }
}
