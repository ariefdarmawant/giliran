// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Giliran} from "../src/Giliran.sol";

/// forge script script/Deploy.s.sol --rpc-url bsc --broadcast --verify   (signer chosen by the deployer, e.g. --ledger)
/// Writes deployments/<chainid>.json so docs and the site read addresses from one place.
contract Deploy is Script {
    address constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;

    function run() external returns (Giliran giliran) {
        vm.startBroadcast();
        giliran = new Giliran(IERC20(BSC_USDT));
        vm.stopBroadcast();

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "block", block.number);
        vm.serializeAddress(obj, "token", BSC_USDT);
        string memory json = vm.serializeAddress(obj, "giliran", address(giliran));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        console2.log("Giliran", address(giliran));
    }
}
