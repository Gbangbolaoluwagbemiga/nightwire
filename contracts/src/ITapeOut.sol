// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// TapeOut protocol on X Layer (chain 196). Read side per TAP-02 §6; write side as used by live X Layer integrations.
interface ITapeOutFactory {
    /// Paid in BEM (factory pulls deployFee + protocolFee via transferFrom); mintPrice is in BEM units (8 decimals).
    function createCPU(string calldata name, string calldata symbol, string calldata story, uint256 transistorSupply, uint256 mintPrice)
        external returns (address transistors, address circuits);
    function bem() external view returns (address);
    function protocolFee() external view returns (uint256);
    function deployFee() external view returns (uint256);
    function isCPU(address) external view returns (bool);
}

interface ITransistors {
    function mint(uint256 id, uint256 amount) external; // id 0 = NAND, 1 = LATCH; paid in BEM
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function balanceOf(address, uint256) external view returns (uint256);
    function owed(address) external view returns (uint256);
    function withdraw() external;
}

interface ICircuits {
    function tapeout(bytes calldata nl, uint32 nIn, uint32 nOut) external payable returns (uint256);
    function TAPEOUT_FEE() external view returns (uint256);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    function step(uint256 id, bytes calldata state, bytes calldata inputs) external view returns (bytes memory newState, bytes memory outputs);
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    function ownerOf(uint256 id) external view returns (address);
}

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// DeWEB (TAP-10, TapeKit SPEC Appendix B) on X Layer
interface IContainerOpener {
    function open(address circuits, uint256 tokenId) external payable;
    function accountOf(address circuits, uint256 tokenId) external view returns (address);
    function isDeployed(address circuits, uint256 tokenId) external view returns (bool);
    function FEE() external view returns (uint256);
}

interface ISiteRegistry {
    function putFile(address container, string calldata path, string calldata contentType, bytes32 sha256Hash, bytes calldata data) external;
    function appendChunk(address container, string calldata path, uint256 expectIndex, bytes calldata data) external;
    function setFallback(address container, string calldata path) external;
    function fileInfo(address container, string calldata path)
        external view returns (uint32 size, string memory contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount);
    function read(address container, string calldata path) external view returns (bytes memory);
}

interface IDomainBinding {
    function bind(string calldata name, address container, uint256 months) external payable;
    function monthlyFee() external view returns (uint256);
    function isContainerLive(address container) external view returns (bool);
}

interface IFactoryList {
    function cpuCount() external view returns (uint256);
    function cpuAt(uint256 i) external view returns (address);
}
