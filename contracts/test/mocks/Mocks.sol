// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("Tether USD", "USDT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Stand-in for the Agent ID registry, etched at its real address in unit tests.
contract MockAgentID {
    mapping(uint256 => address) internal owners;

    function setOwner(string calldata label, address owner) external {
        owners[uint256(keccak256(bytes(label)))] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = owners[tokenId];
        require(o != address(0), "ERC721NonexistentToken");
        return o;
    }

    function balanceOf(address who) external pure returns (uint256) {
        return who == address(0) ? 0 : 1;
    }
}

/// Stand-in for the EIP-2935 block hash history contract: answers any block number with a fixed hash.
contract MockBlockHashHistory {
    fallback(bytes calldata data) external returns (bytes memory) {
        return abi.encode(keccak256(abi.encode("history", abi.decode(data, (uint256)))));
    }
}
