// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICircuits, ITransistors, IERC20} from "./ITapeOut.sol";

interface IERC721Transfer {
    function transferFrom(address from, address to, uint256 id) external;
}

/// @title Nightwire Shop: small, one-tap OKB purchases that never change a score
/// @notice - Cosmetics (base camouflage, tracer colours): pay once, own forever, recorded on chain.
///         - "Tape out my war machine": the player's Boss Forge design (a NAND/LATCH netlist compiled in the game)
///           is taped out as a real circuit on the Nightwire Armory, and the circuit NFT goes to the player.
///           The shop pays the transistors (in BEM, from its own stock) and TapeOut's fee (in OKB) out of the price.
///         Nothing sold here touches gameplay or leaderboards: every score is still replayed move by move.
contract NightwireShop {
    address public owner;
    ICircuits public immutable armory;
    ITransistors public immutable transistors;
    IERC20 public immutable bem;
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

    constructor(ICircuits armory_, ITransistors transistors_, IERC20 bem_, uint256 machinePrice_) {
        owner = msg.sender;
        armory = armory_;
        transistors = transistors_;
        bem = bem_;
        machinePrice = machinePrice_;
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
        bem.approve(address(transistors), unit * (nNand + nLatch) + 2 * pf);
        if (nNand > 0) transistors.mint(0, nNand);
        if (nLatch > 0) transistors.mint(1, nLatch);
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

    function withdrawBem(address to, uint256 amount) external {
        require(msg.sender == owner, "owner");
        bem.transfer(to, amount);
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
