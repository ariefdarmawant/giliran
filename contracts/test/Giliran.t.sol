// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {Giliran} from "../src/Giliran.sol";
import {CircleRef} from "./CircleRef.sol";

contract CreateCircleTest is BaseTest {
    function _make(string memory org, uint256 due, uint64 period, uint64 startAt) internal returns (uint256) {
        return giliran.createCircle(org, labels, due, period, startAt, false, 0);
    }

    function test_createsACircleForTheOrganizerWhoHoldsTheName() public {
        CircleRef c = _create();
        assertEq(c.id(), 0);
        assertEq(giliran.circleCount(), 1);
        assertEq(c.size(), 4);
        assertEq(c.contribution(), DUE);
        assertEq(giliran.labels(c.id())[0], "ayu");
        assertEq(c.joinedCount(), 0); // creating commits nobody's money
    }

    function test_circlesGetConsecutiveIds() public {
        assertEq(_create().id(), 0);
        assertEq(_create().id(), 1);
    }

    function test_revertsWhenCallerDoesNotHoldTheOrganizerName() public {
        vm.prank(holders[1]);
        vm.expectRevert(Giliran.NotNameOwner.selector);
        _make("ayu", DUE, PERIOD, uint64(block.timestamp + 1 hours));
    }

    function test_theOrganizerMustBeAMember() public {
        vm.prank(organizer);
        vm.expectRevert(Giliran.NotMember.selector);
        _make("org", DUE, PERIOD, uint64(block.timestamp + 1 hours));
    }

    function test_revertsOnTooFewOrTooManyMembers() public {
        string[] memory two = new string[](2);
        two[0] = "ayu";
        two[1] = "budi";
        vm.prank(holders[0]);
        vm.expectRevert(Giliran.BadSize.selector);
        giliran.createCircle("ayu", two, DUE, PERIOD, uint64(block.timestamp + 1 hours), false, 0);

        string[] memory many = new string[](26);
        for (uint256 i; i < 26; i++) many[i] = labels[i % 4];
        vm.prank(holders[0]);
        vm.expectRevert(Giliran.BadSize.selector);
        giliran.createCircle("ayu", many, DUE, PERIOD, uint64(block.timestamp + 1 hours), false, 0);
    }

    function test_revertsOnDuplicateMember() public {
        labels[3] = "budi";
        vm.prank(holders[0]);
        vm.expectRevert(Giliran.DuplicateMember.selector);
        _make("ayu", DUE, PERIOD, uint64(block.timestamp + 1 hours));
    }

    function test_revertsOnUnclaimedMemberName() public {
        labels[3] = "nobody";
        vm.prank(holders[0]);
        vm.expectRevert(Giliran.UnknownName.selector);
        _make("ayu", DUE, PERIOD, uint64(block.timestamp + 1 hours));
    }

    function test_revertsOnBadTerms() public {
        vm.startPrank(holders[0]);
        vm.expectRevert(Giliran.BadTerms.selector);
        _make("ayu", 0.01e18 - 1, PERIOD, uint64(block.timestamp + 1 hours)); // just under 0.01 USDT
        vm.expectRevert(Giliran.BadTerms.selector);
        _make("ayu", 100e18 + 1, PERIOD, uint64(block.timestamp + 1 hours));
        vm.expectRevert(Giliran.BadTerms.selector);
        _make("ayu", DUE, 59 minutes, uint64(block.timestamp + 1 hours));
        vm.expectRevert(Giliran.BadTerms.selector);
        _make("ayu", DUE, PERIOD, uint64(block.timestamp));
        vm.expectRevert(Giliran.BadTerms.selector);
        giliran.createCircle("ayu", labels, DUE, PERIOD, uint64(block.timestamp + 1 hours), false, 4); // guarantee not below size
        // no lock-up longer than the terms allow: a round at most 90 days, the start at most 30 days ahead
        vm.expectRevert(Giliran.BadTerms.selector);
        _make("ayu", DUE, 90 days + 1, uint64(block.timestamp + 1 hours));
        vm.expectRevert(Giliran.BadTerms.selector);
        _make("ayu", DUE, PERIOD, uint64(block.timestamp + 30 days + 1));
        _make("ayu", DUE, 90 days, uint64(block.timestamp + 30 days)); // the limits themselves are fine
        vm.stopPrank();
    }

    function testFuzz_acceptsAnyTermsInRange(uint256 due, uint64 period) public {
        due = bound(due, 0.01e18, 100e18);
        period = uint64(bound(period, 1 hours, 30 days));
        vm.prank(holders[0]);
        CircleRef c = new CircleRef(giliran, _make("ayu", due, period, uint64(block.timestamp + 1)));
        assertEq(c.contribution(), due);
        assertEq(c.period(), period);
    }
}

/// Every write is a transaction from a member's own Agent ID wallet; the counters feed the proof page.
contract DirectTest is BaseTest {
    function test_payPullsExactlyOnePaymentFromTheNameHolder() public {
        CircleRef c = _create();
        uint256 before = usdt.balanceOf(holders[1]);
        _pay(c, 1);
        assertEq(usdt.balanceOf(holders[1]), before - DUE);
        assertEq(usdt.balanceOf(address(giliran)), DUE);
        assertTrue(c.paid(0, 1));
    }

    function test_onlyTheNameHolderCanPayForASeat() public {
        CircleRef c = _create();
        vm.expectRevert(Giliran.NotNameOwner.selector);
        _payAs(c, holders[0], "budi");
    }

    function test_paymentNeedsTheMembersApproval() public {
        CircleRef c = _create();
        vm.prank(holders[1]);
        usdt.approve(address(giliran), DUE - 1);
        vm.expectRevert();
        _pay(c, 1);
    }

    function test_unknownCircleIsRefused() public {
        vm.prank(holders[0]);
        vm.expectRevert(Giliran.NoCircle.selector);
        giliran.pay(5, "ayu");
    }

    function test_countersTrackAgentIdWalletsPaymentsAndRounds() public {
        CircleRef c = _createAndStart();
        _pay(c, 0); // ayu again, for round 1 (round 0 paid out when the last member joined)
        (uint256 circles, uint256 payers, uint256 payments, uint256 paidIn, uint256 rounds) = giliran.stats();
        assertEq(circles, 1);
        assertEq(payers, 4);
        assertEq(payments, 5);
        assertEq(paidIn, 5 * DUE);
        assertEq(rounds, 1);
        assertEq(giliran.roundsClosed(), 1); // the counter has an English name
    }

    function test_aNamesRecordCanBeReadByName() public {
        _createAndStart(); // round 0 closed when the last member joined
        (uint32 paid, uint32 missed,,) = giliran.recordOfName("citra");
        assertEq(paid, 1);
        assertEq(missed, 0);
    }
}

contract PayTest is BaseTest {
    CircleRef c;

    function setUp() public override {
        super.setUp();
        c = _createAndStart();
    }

    // Everyone paid round 0 by joining; payments after the start are for the next round.
    function test_paymentIsCreditedToTheNextRound() public {
        _pay(c, 2);
        assertTrue(c.paid(1, 2));
        assertEq(c.potOf(1), DUE);
        assertEq(usdt.balanceOf(c.addr()), DUE); // round 0's pot went out when the last member joined
    }

    function test_secondPaymentPrepaysTheRoundAfter() public {
        _pay(c, 2);
        _pay(c, 2);
        assertTrue(c.paid(2, 2));
        assertEq(c.potOf(2), DUE);
    }


    function test_paymentFromNameOutsideTheCircleIsRefused() public {
        vm.expectRevert(Giliran.NotMember.selector);
        _payAs(c, organizer, "org");
    }

    function test_paymentBeyondTheLastRoundIsRefused() public {
        for (uint256 r = 1; r < 4; r++) _pay(c, 0); // round 0 was paid by joining
        vm.expectRevert(Giliran.AllRoundsPaid.selector);
        _pay(c, 0);
    }

    function test_lateMemberPaysIntoTheCurrentRoundNotAClosedOne() public {
        for (uint256 i = 1; i < 4; i++) _pay(c, i);
        vm.warp(c.deadlineOf(1));
        c.close(1);
        _pay(c, 0);
        assertTrue(c.paid(2, 0));
        assertFalse(c.paid(1, 0));
    }
}

contract CloseTest is BaseTest {
    CircleRef c;

    function setUp() public override {
        super.setUp();
        c = _createAndStart();
    }

    function test_firstRoundPaysTheRecipient() public view {
        assertEq(usdt.balanceOf(holders[0]), 100e18 - DUE + 4 * DUE); // paid out when the last member joined
        assertEq(c.closedRounds(), 1);
    }

    function test_fullyPaidRoundClosesBeforeItsDeadline() public {
        uint256 before = usdt.balanceOf(holders[1]);
        for (uint256 i; i < 4; i++) _pay(c, i);
        assertLt(block.timestamp, c.deadlineOf(1));
        assertEq(c.closedRounds(), 2);
        assertEq(usdt.balanceOf(holders[1]), before - DUE + 4 * DUE);
    }

    function test_cannotCloseAnUnpaidRoundBeforeItsDeadline() public {
        _pay(c, 0);
        vm.expectRevert(Giliran.NotDue.selector);
        c.close(1);
    }

    function test_partialRoundPaysWhatWasPaidAndRecordsTheMiss() public {
        _pay(c, 0);
        _pay(c, 1);
        _pay(c, 2);
        vm.warp(c.deadlineOf(1));
        uint256 before = usdt.balanceOf(holders[1]);
        c.close(1);
        assertEq(usdt.balanceOf(holders[1]), before + 3 * DUE);
        (uint32 paid, uint32 missed,,) = giliran.recordOf(keccak256("dewi"));
        assertEq(paid, 1);
        assertEq(missed, 1);
        (paid,,,) = giliran.recordOf(keccak256("ayu"));
        assertEq(paid, 2);
    }

    function test_roundsCloseInOrderAndOnlyOnce() public {
        vm.expectRevert(Giliran.WrongRound.selector);
        c.close(0); // closed when the last member joined
        vm.expectRevert(Giliran.WrongRound.selector);
        c.close(2);
        vm.warp(c.deadlineOf(1));
        c.close(1);
        vm.expectRevert(Giliran.WrongRound.selector);
        c.close(1);
    }

    function test_missAfterReceivingThePotIsFlagged() public {
        // ayu received round 0 when the last member joined
        for (uint256 i = 1; i < 4; i++) _pay(c, i);
        vm.warp(c.deadlineOf(1));
        c.close(1);
        (,, uint32 afterPot,) = giliran.recordOf(keccak256("ayu"));
        assertEq(afterPot, 1);
        (,, afterPot,) = giliran.recordOf(keccak256("dewi"));
        assertEq(afterPot, 0);
    }

    /// Names cannot be moved or burned, so a name that fails to resolve means the registry failed: the recipient is
    /// paid at the wallet that last paid for their seat (their own), and keeps their turn.
    function test_aRecipientWhoseNameStopsResolvingIsPaidAtTheirOwnWallet() public {
        CircleRef d = _create();
        for (uint256 i; i < 3; i++) _pay(d, i);
        uint256 before = usdt.balanceOf(holders[0]);
        vm.mockCallRevert(AGENT_ID, abi.encodeWithSignature("ownerOf(uint256)", uint256(keccak256("ayu"))), "");
        _pay(d, 3);
        assertEq(d.closedRounds(), 1);
        assertEq(usdt.balanceOf(holders[0]), before + 4 * DUE);
        assertEq(d.payoutOf(0), 4 * DUE);
    }
    function test_fullCircleMarksCompletionOnlyForCleanMembers() public {
        for (uint256 r; r < 4; r++) {
            for (uint256 i; i < 4; i++) {
                if (r == 0) break; // paid by joining
                if (r == 2 && i == 3) continue; // dewi misses round 2
                _pay(c, i);
            }
            vm.warp(c.deadlineOf(r));
            _closeIfOpen(c, r);
        }
        assertTrue(c.finished());
        (,,, uint32 done) = giliran.recordOf(keccak256("ayu"));
        assertEq(done, 1);
        (,,, done) = giliran.recordOf(keccak256("dewi"));
        assertEq(done, 0);
        assertEq(usdt.balanceOf(c.addr()), 0);
    }

}
