// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Giliran, IAgentID} from "../src/Giliran.sol";

/// A whole circle on BSC mainnet state: the real Agent ID registry and real BSC USDT (18 decimals).
/// Members approve the exact dues and pay from the wallets that hold their names, as an Agentic Wallet does.
/// FORK_TESTS=1 forge test --match-path test/Circle.fork.t.sol
/// Exposes the draw's hash lookup.
contract GiliranHarness is Giliran {
    constructor(IERC20 t) Giliran(t) {}

    function hashOf(uint256 b) external view returns (bytes32) {
        return _hashOf(b);
    }
}

contract CircleForkTest is Test {
    IERC20 constant USDT = IERC20(0x55d398326f99059fF775485246999027B3197955);
    IAgentID constant AGENT_ID = IAgentID(0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F);
    uint256 constant DUE = 2e18;

    Giliran giliran;
    string[] labels;
    address[] holders;

    function setUp() public {
        if (vm.envOr("FORK_TESTS", uint256(0)) == 0) vm.skip(true);
        _forkBehindHead();
        giliran = new Giliran(USDT);
        string[3] memory names = ["giliran-fork-a", "giliran-fork-b", "giliran-fork-c"];
        for (uint256 i; i < 3; i++) {
            address h = makeAddr(names[i]);
            labels.push(names[i]);
            holders.push(h);
            // these test names belong to these wallets (the real registry is consulted for everything else)
            vm.mockCall(address(AGENT_ID), abi.encodeCall(IAgentID.ownerOf, (uint256(keccak256(bytes(names[i]))))), abi.encode(h));
            deal(address(USDT), h, 20e18);
            vm.prank(h);
            USDT.approve(address(giliran), 3 * DUE); // the exact dues of a 3-round circle, nothing more
        }
    }

    function test_realRegistryResolvesAClaimedNameAndRejectsUnclaimed() public {
        // persons.ai is a real claimed Agent ID; an unclaimed label must not resolve.
        assertTrue(AGENT_ID.ownerOf(uint256(keccak256("persons"))) != address(0));
        string[] memory bad = new string[](3);
        bad[0] = labels[0];
        bad[1] = labels[1];
        bad[2] = "giliran-surely-unclaimed-label-x9";
        vm.prank(holders[0]);
        vm.expectRevert(Giliran.UnknownName.selector);
        giliran.createCircle(labels[0], bad, DUE, 1 days, uint64(vm.getBlockTimestamp() + 1 hours), false, 0);
    }

    function test_fullCircleWithRealUsdt() public {
        vm.prank(holders[0]);
        uint256 id = giliran.createCircle(labels[0], labels, DUE, 1 days, uint64(vm.getBlockTimestamp() + 1 hours), false, 0);
        (,, uint64 startAt,,,,,,) = giliran.circleInfo(id);
        for (uint256 r; r < 3; r++) {
            uint256 before = USDT.balanceOf(holders[r]);
            for (uint256 i; i < 3; i++) {
                vm.prank(holders[i]); // each member's own wallet sends their own payment
                giliran.pay(id, labels[i]); // the last one fills the round and pays it out: nobody opens it
            }
            (,,,,,,, uint256 closed,) = giliran.circleInfo(id);
            assertEq(closed, r + 1);
            assertEq(USDT.balanceOf(holders[r]), before - DUE + 3 * DUE);
            if (r == 0) vm.warp(startAt);
        }
        assertTrue(giliran.finished(id));
        assertEq(USDT.balanceOf(address(giliran)), 0);
        for (uint256 i; i < 3; i++) assertEq(USDT.allowance(holders[i], address(giliran)), 0); // approval used up exactly
        (uint32 paid,,, uint32 done) = giliran.recordOfName(labels[1]);
        assertEq(paid, 3);
        assertEq(done, 1);
        (uint256 circles, uint256 payers, uint256 payments, uint256 paidIn, uint256 rounds) = giliran.stats();
        assertEq(circles, 1);
        assertEq(payers, 3);
        assertEq(payments, 9);
        assertEq(paidIn, 9 * DUE);
        assertEq(rounds, 3);
    }

    /// On real BSC state the draw's lookup still finds a block's hash 300 blocks back, where `blockhash` returns
    /// zero, and it is the hash BSC's EIP-2935 history contract serves. (That history returns the true hash was
    /// checked against `cast block <n> --field hash` on 2026-11-23, 10, 300 and 5,000 blocks back.)
    function test_drawHashLookupReadsRealHistoryPast256Blocks() public {
        GiliranHarness h = new GiliranHarness(USDT);
        uint256 b = block.number - 300;
        assertEq(blockhash(b), bytes32(0));
        (bool ok, bytes memory ret) = h.BLOCK_HASH_HISTORY().staticcall(abi.encode(b));
        assertTrue(ok && ret.length == 32, "EIP-2935 history is live on BSC");
        bytes32 fromHistory = abi.decode(ret, (bytes32));
        assertTrue(fromHistory != bytes32(0));
        assertEq(h.hashOf(b), fromHistory);
    }

    /// Public RPCs often lack state at the very head; fork 200 blocks back (or FORK_BLOCK).
    function _forkBehindHead() internal {
        uint256 at = vm.envOr("FORK_BLOCK", uint256(0));
        if (at == 0) {
            bytes memory r = vm.rpc("bsc", "eth_blockNumber", "[]");
            at = (uint256(bytes32(r)) >> (8 * (32 - r.length))) - 200;
        }
        vm.createSelectFork("bsc", at);
    }
}
