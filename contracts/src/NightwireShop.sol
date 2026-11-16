// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICircuits} from "./ITapeOut.sol";

interface ITransistorsOkb {
    function mint(uint256 id, uint256 amount) external payable; // paid in OKB on the processors we use
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
}

interface IERC721Transfer {
    function transferFrom(address from, address to, uint256 id) external;
}

/// @title Nightwire Shop: small, one-tap OKB purchases that never change a score
/// @notice - Cosmetics (base camouflage, tracer colours): pay once, own forever, recorded on chain.
///         - "Tape out my war machine": the player's Boss Forge design (a NAND/LATCH netlist compiled in the game)
///           is taped out as a real circuit on the Nightwire Armory, and the circuit NFT goes to the player.
///           The shop pays the transistors and TapeOut's fee (all in OKB) out of the price.
///         Nothing sold here touches gameplay or leaderboards: every score is still replayed move by move.
contract NightwireShop {
    address public owner;
    ICircuits public immutable armory;
    ITransistorsOkb public immutable transistors;
    uint256 public machinePrice; // OKB, for one tape-out
    uint256 public constant MAX_MACHINE_GATES = 160;

    mapping(uint256 => uint256) public price; // cosmetic id => OKB (0 = not for sale)
    mapping(address => mapping(uint256 => bool)) public owns;
    mapping(address => uint256[]) internal machinesOf;

    event Purchased(address indexed buyer, uint256 indexed item, uint256 paid);
    event MachineTapedOut(address indexed buyer, uint256 indexed circuitId, bytes32 indexed designHash, uint256 gates);
    event PriceSet(uint256 indexed item, uint256 price);

    error WrongPrice();
    error AlreadyOwned();
    error BadNetlist();

    constructor(ICircuits armory_, ITransistorsOkb transistors_, uint256 machinePrice_) {
        owner = msg.sender;
        armory = armory_;
        transistors = transistors_;
        machinePrice = machinePrice_;
    }

    /// what one tape-out of a netlist costs the shop right now (transistors + fees), in OKB
    function costOf(uint256 nNand, uint256 nLatch) public view returns (uint256) {
        uint256 unit = transistors.mintPrice();
        uint256 pf = transistors.protocolFee();
        return unit * (nNand + nLatch) + (nNand > 0 ? pf : 0) + (nLatch > 0 ? pf : 0) + armory.TAPEOUT_FEE();
    }

    // ------------------------------------------------------------------ cosmetics
    function buy(uint256 item) external payable {
        uint256 p = price[item];
        if (p == 0 || msg.value != p) revert WrongPrice();
        if (owns[msg.sender][item]) revert AlreadyOwned();
        owns[msg.sender][item] = true;
        emit Purchased(msg.sender, item, msg.value);
    }

    /// owned flags for a list of items, for the game to read in one call
    function ownedOf(address who, uint256[] calldata items) external view returns (bool[] memory out) {
        out = new bool[](items.length);
        for (uint256 i; i < items.length; i++) out[i] = owns[who][items[i]];
    }

    // ------------------------------------------------------------------ war machines
    /// Tape out a Boss Forge brain (7 inputs, 2 outputs, NAND and LATCH only) and hand the circuit to the buyer.
    function tapeOutMachine(bytes calldata netlist, bytes32 designHash) external payable returns (uint256 id) {
        if (msg.value != machinePrice) revert WrongPrice();
        (uint256 nNand, uint256 nLatch) = _count(netlist);
        if (nNand + nLatch == 0 || nNand + nLatch > MAX_MACHINE_GATES) revert BadNetlist();
        uint256 unit = transistors.mintPrice();
        uint256 pf = transistors.protocolFee();
        require(msg.value >= costOf(nNand, nLatch), "price below cost");
        if (nNand > 0) transistors.mint{value: unit * nNand + pf}(0, nNand);
        if (nLatch > 0) transistors.mint{value: unit * nLatch + pf}(1, nLatch);
        id = armory.tapeout{value: armory.TAPEOUT_FEE()}(netlist, 7, 2);
        IERC721Transfer(address(armory)).transferFrom(address(this), msg.sender, id);
        machinesOf[msg.sender].push(id);
        emit MachineTapedOut(msg.sender, id, designHash, nNand + nLatch);
    }

    function machinesOwnedBy(address who) external view returns (uint256[] memory) {
        return machinesOf[who];
    }

    /// counts NAND (0x00, 7 bytes) and LATCH (0x01, 4 bytes) records; anything else (REF) is refused
    function _count(bytes calldata nl) internal pure returns (uint256 nNand, uint256 nLatch) {
        uint256 i;
        while (i < nl.length) {
            uint8 op = uint8(nl[i]);
            if (op == 0) { nNand++; i += 7; }
            else if (op == 1) { nLatch++; i += 4; }
            else revert BadNetlist();
        }
        if (i != nl.length) revert BadNetlist();
    }

    // ------------------------------------------------------------------ admin
    function setPrice(uint256 item, uint256 p) external {
        require(msg.sender == owner, "owner");
        price[item] = p;
        emit PriceSet(item, p);
    }

    function setMachinePrice(uint256 p) external {
        require(msg.sender == owner, "owner");
        machinePrice = p;
    }

    function withdraw(address to) external {
        require(msg.sender == owner, "owner");
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "pay");
    }

    // the shop briefly holds transistors (ERC-1155) and the circuit NFT (ERC-721) while taping out
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}
