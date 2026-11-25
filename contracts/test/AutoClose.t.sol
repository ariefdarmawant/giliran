// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {CircleRef} from "./CircleRef.sol";

/// A payment also closes the round it makes due, so nobody has to remember to open the kocokan.
/// - The payment that fills a round pays it out in the same transaction (the last join fills round 0).
/// - The first payment after a deadline closes the overdue round, after counting itself if it is late.
/// - In draw mode a payment schedules the draw or, once its block has passed, draws and pays.
///   The last round has one member left, so it pays without a draw.
/// `close` stays open to anyone for rounds nobody pays into.
contract AutoCloseTest is BaseTest {
    function _join(CircleRef c) internal {
        for (uint256 i; i < labels.length; i++) _pay(c, i);
    }

    // fixed order

    function test_theLastJoinPaysOutTheFirstRound() public {
        CircleRef c = _create();
        for (uint256 i; i < 3; i++) _pay(c, i);
        assertEq(c.closedRounds(), 0);
        uint256 before = usdt.balanceOf(holders[0]);
        _pay(c, 3);
        assertLt(block.timestamp, c.startAt());
        assertEq(c.closedRounds(), 1);
        assertEq(usdt.balanceOf(holders[0]), before + 4 * DUE);
    }

    function test_thePaymentThatFillsARoundPaysItOut() public {
        CircleRef c = _create();
        _join(c);
        vm.warp(c.startAt());
        for (uint256 i; i < 3; i++) _pay(c, i);
        assertEq(c.closedRounds(), 1);
        uint256 before = usdt.balanceOf(holders[1]);
        _pay(c, 3);
        assertEq(c.closedRounds(), 2);
        assertEq(usdt.balanceOf(holders[1]), before + 4 * DUE);
    }

    function test_aPaymentBeforeTheDeadlineLeavesAnUnfilledRoundOpen() public {
        CircleRef c = _create();
        _join(c);
        vm.warp(c.startAt());
        _pay(c, 0);
        assertEq(c.closedRounds(), 1);
    }

    function test_theFirstPaymentAfterADeadlineClosesTheOverdueRound() public {
        CircleRef c = _create();
        _join(c);
        vm.warp(c.startAt());
        for (uint256 i; i < 3; i++) _pay(c, i); // dewi skips round 1
        vm.warp(c.deadlineOf(1));
        uint256 before = usdt.balanceOf(holders[1]);
        _pay(c, 0); // ayu pays round 2
        assertTrue(c.paid(2, 0));
        assertEq(c.closedRounds(), 2);
        assertEq(usdt.balanceOf(holders[1]), before + 3 * DUE);
        (, uint32 missed,,) = giliran.recordOf(keccak256("dewi"));
        assertEq(missed, 1);
    }

    function test_aLatePaymentCountsBeforeItClosesTheRound() public {
        CircleRef c = _create();
        _join(c);
        vm.warp(c.startAt());
        for (uint256 i; i < 3; i++) _pay(c, i);
        vm.warp(c.deadlineOf(1) + 1 hours);
        uint256 before = usdt.balanceOf(holders[1]);
        _pay(c, 3); // dewi, late for round 1
        assertTrue(c.paid(1, 3));
        assertEq(c.closedRounds(), 2);
        assertEq(usdt.balanceOf(holders[1]), before + 4 * DUE);
        (, uint32 missed,,) = giliran.recordOf(keccak256("dewi"));
        assertEq(missed, 0);
    }

    function test_aPaymentClosesOneRoundAtATime() public {
        CircleRef c = _create();
        _join(c);
        vm.warp(c.deadlineOf(2)); // rounds 1 and 2 both overdue, nobody paid
        _pay(c, 0);
        assertEq(c.closedRounds(), 2);
        c.close(2);
        assertEq(c.closedRounds(), 3);
    }

    // draw mode

    function test_theFillingPaymentSchedulesTheDraw() public {
        CircleRef c = _createWith(true, 0);
        _join(c);
        assertEq(c.closedRounds(), 0);
        assertEq(c.drawBlockOf(0), block.number + c.DRAW_DELAY());
    }

    function test_aPaymentWhileTheDrawIsPendingStillLands() public {
        CircleRef c = _createWith(true, 0);
        _join(c);
        vm.warp(c.startAt());
        _pay(c, 0); // same block as the schedule: the draw block is not mined yet
        assertTrue(c.paid(1, 0));
        assertEq(c.closedRounds(), 0);
    }

    function test_aPaymentAfterTheDrawBlockDrawsAndPays() public {
        CircleRef c = _createWith(true, 0);
        _join(c);
        uint256 target = c.drawBlockOf(0);
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("unknown when scheduled"));
        vm.warp(c.startAt());
        _pay(c, 0);
        assertEq(c.closedRounds(), 1);
        assertTrue(c.received(c.recipientOf(0)));
    }

    function test_theLastRoundPaysWithoutADraw() public {
        CircleRef c = _createWith(true, 0);
        _join(c);
        vm.warp(c.startAt());
        for (uint256 r; r < 3; r++) {
            if (r > 0) for (uint256 i; i < 4; i++) _pay(c, i); // the fourth payment schedules the draw
            uint256 target = c.drawBlockOf(r);
            vm.roll(target + 1);
            vm.setBlockhash(target, keccak256(abi.encode(r)));
            c.close(r);
        }
        uint256 last;
        while (c.received(last)) last++;
        uint256 before = usdt.balanceOf(holders[last]);
        for (uint256 i; i < 3; i++) _pay(c, i);
        _pay(c, 3);
        assertTrue(c.finished());
        assertEq(c.recipientOf(3), last);
        assertEq(usdt.balanceOf(holders[last]), before - DUE + 4 * DUE); // paid the last due, got the pot
    }

    // gas: the payment that closes a round carries the payout

    /// The largest circle (25 members, 3 dues of guarantee): the last join pays round 0 out. Wallets estimate
    /// gas before sending, so this only has to fit a block, but it is worth knowing.
    function test_theFillingPaymentInTheLargestCircleStaysUnderOneAndAHalfMillionGas() public {
        string[] memory many = new string[](25);
        for (uint256 i; i < 25; i++) {
            many[i] = string(abi.encodePacked("m", vm.toString(i)));
            address h = makeAddr(many[i]);
            ids.setOwner(many[i], h);
            usdt.mint(h, DUE);
            vm.prank(h);
            usdt.approve(address(giliran), DUE);
        }
        vm.prank(makeAddr("m0"));
        uint256 id = giliran.createCircle("m0", many, DUE, PERIOD, uint64(block.timestamp + 1 hours), false, 3);
        for (uint256 i; i < 24; i++) {
            vm.prank(makeAddr(many[i]));
            giliran.pay(id, many[i]);
        }
        vm.prank(makeAddr("m24"));
        uint256 g = gasleft();
        giliran.pay(id, "m24");
        g -= gasleft();
        (,,,,,,, uint256 closed,) = giliran.circleInfo(id);
        assertEq(closed, 1);
        emit log_named_uint("gas, filling payment of a 25-member circle", g);
        assertLt(g, 1_500_000); // about 1.1M on 2026-11-25: the payout, 25 records, 3 prepaid dues
    }
}

/// The smallest dues the contract takes: 0.01 USDT a round, paid out whole like any other circle.
contract SmallDuesTest is BaseTest {
    function test_aCircleAtTheMinimumRunsEndToEnd() public {
        uint256 cent = giliran.MIN_CONTRIBUTION();
        assertEq(cent, 0.01e18);
        vm.prank(holders[0]);
        uint256 id = giliran.createCircle("ayu", labels, cent, PERIOD, uint64(block.timestamp + 1 hours), false, 0);
        uint256 before = usdt.balanceOf(holders[0]);
        for (uint256 i; i < 4; i++) {
            vm.prank(holders[i]);
            giliran.pay(id, labels[i]); // the last join pays round 1 out
        }
        assertEq(usdt.balanceOf(holders[0]), before - cent + 4 * cent);
        assertEq(giliran.payoutOf(id, 0), 4 * cent);
    }
}
