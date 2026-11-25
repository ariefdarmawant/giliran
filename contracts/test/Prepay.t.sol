// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {CircleRef} from "./CircleRef.sol";
import {MockBlockHashHistory} from "./mocks/Mocks.sol";

/// The guarantee is the recipient's next dues, paid from their payout the moment they receive it. Those rounds
/// count the recipient as paid straight away, so they can fill (and pay out) as soon as everyone else has paid.
contract PrepayTest is BaseTest {
    function _join(CircleRef c) internal {
        for (uint256 i; i < labels.length; i++) _pay(c, i);
    }

    function test_thePayoutPaysTheRecipientsNextDuesAtOnce() public {
        CircleRef c = _createWith(false, 2);
        _join(c); // ayu receives round 0
        assertEq(usdt.balanceOf(holders[0]), 100e18 - DUE + 4 * DUE - 2 * DUE);
        assertTrue(c.covered(1, 0));
        assertTrue(c.covered(2, 0));
        assertFalse(c.covered(3, 0));
        assertEq(c.paidCount(1), 1);
        assertEq(c.potOf(1), DUE);
    }

    function test_aRoundWithAPrepaidMemberFillsWhenTheOthersPay() public {
        CircleRef c = _createWith(false, 1);
        _join(c);
        vm.warp(c.startAt());
        uint256 before = usdt.balanceOf(holders[1]);
        for (uint256 i = 1; i < 4; i++) _pay(c, i); // ayu's round 1 was paid from her payout
        assertLt(block.timestamp, c.deadlineOf(1));
        assertEq(c.closedRounds(), 2);
        assertEq(usdt.balanceOf(holders[1]), before - DUE + 4 * DUE - DUE); // budi's next due paid from his payout
    }

    function test_thePrepaidMemberIsNotAskedForThatDue() public {
        CircleRef c = _createWith(false, 1);
        _join(c);
        vm.warp(c.startAt());
        _pay(c, 0); // ayu pays: it goes to round 2, round 1 is already hers
        assertTrue(c.paid(2, 0));
        assertFalse(c.paid(1, 0));
    }

    function test_nothingIsHeldFromSomeoneWhoAlreadyPaidAhead() public {
        CircleRef c = _createWith(false, 3);
        _join(c);
        vm.warp(c.startAt());
        for (uint256 k; k < 3; k++) _pay(c, 1); // budi pays rounds 1, 2 and 3 himself
        uint256 before = usdt.balanceOf(holders[1]);
        _pay(c, 2);
        _pay(c, 3); // round 1 fills: budi receives it whole
        assertEq(c.closedRounds(), 2);
        assertEq(usdt.balanceOf(holders[1]), before + 4 * DUE);
        assertEq(c.payoutOf(1), 4 * DUE);
    }

    function test_aFullGuaranteeMeansTheRecipientNeverPaysAgainAndEveryoneEndsWhole() public {
        CircleRef c = _createWith(false, 3);
        _join(c);
        vm.warp(c.startAt());
        for (uint256 r = 1; r < 4; r++) {
            for (uint256 i; i < 4; i++) if (i >= r) _pay(c, i); // each recipient's later dues were prepaid
            assertEq(c.closedRounds(), r + 1); // and each round filled without waiting for its deadline
        }
        assertTrue(c.finished());
        for (uint256 i; i < 4; i++) assertEq(usdt.balanceOf(holders[i]), 100e18);
        assertEq(usdt.balanceOf(c.addr()), 0);
    }

    function test_payoutOfIsWhatTheRecipientActuallyGot() public {
        CircleRef c = _createWith(false, 2);
        _join(c);
        assertEq(c.payoutOf(0), 2 * DUE); // pot of 4, 2 paid ahead for ayu
        vm.warp(c.startAt());
        for (uint256 i; i < 3; i++) _pay(c, i); // ayu's goes to round 3 (1 and 2 are prepaid); dewi skips round 1
        vm.warp(c.deadlineOf(1));
        c.close(1);
        assertEq(c.payoutOf(1), 3 * DUE - 2 * DUE); // ayu's prepaid due, budi's, citra's; 2 pay budi's next dues
    }

    function test_claimedSaysWhetherANameExistsAndNothingMore() public view {
        assertTrue(giliran.claimed("ayu"));
        assertFalse(giliran.claimed("nobody-has-this"));
    }

    function test_organizerOfNamesTheOrganizer() public {
        CircleRef c = _create();
        assertEq(giliran.organizerOf(c.id()), "ayu");
    }

    // a lapsed draw: one call, never a restart

    /// Past the history window the draw reads a later block of the form target + k * DRAW_WINDOW, a block nobody
    /// knew when the draw was scheduled, so a call days later still draws and pays in one step.
    function test_aDrawLeftForDaysStillPaysInOneCall() public {
        vm.etch(giliran.BLOCK_HASH_HISTORY(), address(new MockBlockHashHistory()).code);
        CircleRef c = _createWith(true, 0);
        _join(c); // schedules round 0's draw
        uint256 target = c.drawBlockOf(0);
        vm.roll(target + 3 * giliran.DRAW_WINDOW() + 500);
        c.close(0);
        assertEq(c.closedRounds(), 1);
        assertEq(c.drawBlockOf(0), target); // not rescheduled
    }

    function test_aLateDrawUsesABlockAfterTheTarget() public {
        vm.etch(giliran.BLOCK_HASH_HISTORY(), address(new MockBlockHashHistory()).code);
        CircleRef c = _createWith(true, 0);
        _join(c);
        uint256 target = c.drawBlockOf(0);
        uint256 w = giliran.DRAW_WINDOW();
        assertEq(giliran.drawSourceBlock(target, target + w + 10), target + w);
        assertEq(giliran.drawSourceBlock(target, target + 2), target); // early: the target itself
        assertEq(giliran.drawSourceBlock(target, target + w + 2), target); // still in the window
    }
}
