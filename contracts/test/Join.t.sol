// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {Giliran} from "../src/Giliran.sol";
import {CircleRef} from "./CircleRef.sol";

/// Joining is paying: a member's first payment, before the start, takes their seat (no separate accept call,
/// so members never need Developer Mode). The circle runs only once everyone has joined.
contract JoinTest is BaseTest {
    CircleRef c;

    function setUp() public override {
        super.setUp();
        c = _create();
    }

    function test_firstPaymentBeforeStartTakesTheSeat() public {
        _pay(c, 2);
        assertTrue(c.joined(2));
        assertEq(c.joinedCount(), 1);
        assertTrue(c.paid(0, 2));
        assertEq(c.potOf(0), DUE);
        assertFalse(c.active());
    }

    function test_onlyOnePaymentBeforeStart() public {
        _pay(c, 2);
        vm.expectRevert(Giliran.AlreadyJoined.selector);
        _pay(c, 2);
    }

    function test_onlyTheNameHolderCanJoin() public {
        vm.expectRevert(Giliran.NotNameOwner.selector);
        _payAs(c, holders[1], labels[2]);
    }

    function test_runsOnceEveryoneHasJoined() public {
        for (uint256 i; i < 3; i++) _pay(c, i);
        assertFalse(c.active());
        _pay(c, 3);
        assertTrue(c.active());
    }

    /// Round 0 is fully paid once everyone has joined, so it pays out then, even before the start.
    function test_firstRoundPaysOnceEveryoneHasJoined() public {
        uint256 before = usdt.balanceOf(holders[0]);
        for (uint256 i; i < 4; i++) _pay(c, i);
        assertLt(block.timestamp, c.startAt());
        assertEq(c.closedRounds(), 1);
        assertEq(usdt.balanceOf(holders[0]), before - DUE + 4 * DUE);
    }

    function test_roundEveryPeriodFromTheStart() public view {
        assertEq(c.deadlineOf(0), c.startAt());
        assertEq(c.deadlineOf(2), c.startAt() + 2 * PERIOD);
    }

    function test_paymentAfterStartGoesToTheNextRound() public {
        for (uint256 i; i < 4; i++) _pay(c, i);
        vm.warp(c.startAt());
        _pay(c, 1);
        assertTrue(c.paid(1, 1));
    }

    function test_circleThatDidNotFillIsCancelledAndJoinersGetTheirPaymentBack() public {
        for (uint256 i; i < 3; i++) _pay(c, i);
        vm.warp(c.startAt());
        vm.expectRevert(Giliran.NotActive.selector);
        _pay(c, 3);

        uint256[3] memory before;
        for (uint256 i; i < 3; i++) before[i] = usdt.balanceOf(holders[i]);
        c.cancel(); // anyone may call it
        assertTrue(c.cancelled());
        for (uint256 i; i < 3; i++) assertEq(usdt.balanceOf(holders[i]), before[i] + DUE);
        assertEq(usdt.balanceOf(c.addr()), 0);

        vm.expectRevert(Giliran.NotActive.selector);
        c.cancel();
        vm.expectRevert(Giliran.NotActive.selector);
        c.close(0);
    }

    function test_cannotCancelBeforeTheStartOrAFullCircle() public {
        vm.expectRevert(Giliran.NotStarted.selector);
        c.cancel();
        for (uint256 i; i < 4; i++) _pay(c, i);
        vm.warp(c.startAt());
        vm.expectRevert(Giliran.Full.selector);
        c.cancel();
    }

    function testFuzz_cancelReturnsExactlyWhatJoinersPaid(uint8 joiners) public {
        joiners = uint8(bound(joiners, 0, 3));
        for (uint256 i; i < joiners; i++) _pay(c, i);
        vm.warp(c.startAt() + 1);
        uint256 inCircle = usdt.balanceOf(c.addr());
        assertEq(inCircle, joiners * DUE);
        c.cancel();
        assertEq(usdt.balanceOf(c.addr()), 0);
    }
}
