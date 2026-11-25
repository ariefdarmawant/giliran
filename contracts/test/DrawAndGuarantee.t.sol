// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {Giliran} from "../src/Giliran.sol";
import {CircleRef} from "./CircleRef.sol";
import {MockBlockHashHistory} from "./mocks/Mocks.sol";

/// The draw: in draw mode each round's recipient is drawn from a block hash that nobody knew when the
/// round closed, among members who have not received yet.
contract DrawTest is BaseTest {
    CircleRef c;

    function setUp() public override {
        super.setUp();
        c = _createWith(true, 0);
        _start(c);
    }

    function test_theLastJoinSchedulesTheDrawAndPaysNothingYet() public view {
        assertEq(c.closedRounds(), 0);
        assertEq(c.drawBlockOf(0), block.number + c.DRAW_DELAY());
        assertEq(usdt.balanceOf(c.addr()), 4 * DUE);
    }

    function test_drawCannotSettleBeforeItsBlock() public {
        vm.expectRevert(Giliran.DrawPending.selector);
        c.close(0);
    }

    function test_drawPicksAMemberAndPaysTheirName() public {
        uint256 target = c.drawBlockOf(0);
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("some future hash"));
        c.close(0);
        assertEq(c.closedRounds(), 1);
        uint256 winner = c.recipientOf(0);
        assertTrue(c.received(winner));
        assertEq(usdt.balanceOf(holders[winner]), 100e18 - DUE + 4 * DUE);
    }

    /// BSC makes a block about every 0.45 s, so 256 blocks is under two minutes. Past that the draw reads the
    /// hash from the EIP-2935 history contract (about an hour of blocks), so a losing member can't wait it out.
    function test_drawReadsTheHashFromHistoryAfter256Blocks() public {
        vm.etch(giliran.BLOCK_HASH_HISTORY(), address(new MockBlockHashHistory()).code);
        uint256 target = c.drawBlockOf(0);
        vm.roll(target + 300); // blockhash(target) is now 0
        c.close(0);
        assertEq(c.closedRounds(), 1); // drawn, not rescheduled
        assertTrue(c.received(c.recipientOf(0)));
    }

    function test_expiredDrawBlockIsRescheduledNotZeroHashed() public {
        uint256 target = c.drawBlockOf(0);
        vm.roll(target + 300); // blockhash(target) is now 0
        c.close(0);
        assertEq(c.closedRounds(), 0);
        assertEq(c.drawBlockOf(0), block.number + c.DRAW_DELAY());
    }

    function testFuzz_everyMemberReceivesExactlyOnce(bytes32 seed) public {
        bool[4] memory got;
        for (uint256 r; r < 4; r++) {
            if (r > 0) for (uint256 i; i < 4; i++) _pay(c, i); // round 0 was paid by joining
            if (r < 3) {
                // the payment that filled the round scheduled the draw; the last round has nobody left to draw
                uint256 target = c.drawBlockOf(r);
                vm.roll(target + 1);
                vm.setBlockhash(target, keccak256(abi.encode(seed, r)));
                c.close(r);
            }
            uint256 w = c.recipientOf(r);
            assertFalse(got[w]);
            got[w] = true;
        }
        assertTrue(c.finished());
        assertEq(usdt.balanceOf(c.addr()), 0);
    }
}

/// Guarantee: part of each payout pays the recipient's next dues at once, so leaving after their turn takes
/// nothing from the others.
contract GuaranteeTest is BaseTest {
    CircleRef c;

    function setUp() public override {
        super.setUp();
        c = _createWith(false, 2); // hold back two dues from each payout
        _start(c);
    }

    /// Close round r after everyone but `skip` paid it (round 0 was paid by joining; prepaid dues need no payment).
    function _round(uint256 r, uint256 skip) internal {
        for (uint256 i; i < 4 && r > 0; i++) {
            if (i != skip && !c.paid(r, i) && !c.covered(r, i)) _pay(c, i);
        }
        vm.warp(c.deadlineOf(r));
        _closeIfOpen(c, r);
    }

    function test_payoutHoldsBackTheGuarantee() public view {
        // round 0 paid out when the last member joined
        assertEq(usdt.balanceOf(holders[0]), 100e18 - DUE + 4 * DUE - 2 * DUE); // pot minus 2 dues held
        assertTrue(c.covered(1, 0) && c.covered(2, 0) && !c.covered(3, 0));
    }

    function test_guaranteeCoversAMissAfterPayoutSoTheRoundIsWhole() public {
        _round(0, type(uint256).max); // ayu receives, 2 dues held
        uint256 budiBefore = usdt.balanceOf(holders[1]);
        _round(1, 0); // ayu stops paying in round 1
        assertEq(usdt.balanceOf(holders[1]), budiBefore - DUE + 4 * DUE - 2 * DUE); // round is whole
        assertTrue(c.covered(2, 0));
        (, uint32 missed, uint32 afterPot,) = giliran.recordOf(keccak256("ayu"));
        assertEq(missed, 0); // her guarantee paid it on time
        assertEq(afterPot, 0);
    }

    function test_heldBackIsCappedByRoundsLeft() public {
        _round(0, type(uint256).max);
        _round(1, type(uint256).max);
        _round(2, type(uint256).max); // citra: only one round left after hers
        assertTrue(c.covered(3, 2)); // citra: one due left after her turn, so one is paid
        uint256 before = usdt.balanceOf(holders[3]);
        _round(3, type(uint256).max); // last recipient: nothing held back
        assertEq(c.payoutOf(3), 4 * DUE);
        assertEq(usdt.balanceOf(holders[3]), before - DUE + 4 * DUE);
    }

    function test_everyoneEndsWholeWithAGuarantee() public {
        for (uint256 r; r < 4; r++) _round(r, type(uint256).max);
        assertTrue(c.finished());
        for (uint256 i; i < 4; i++) {
            assertEq(usdt.balanceOf(holders[i]), 100e18); // 4 dues in, one 4-due pot out
        }
        assertEq(usdt.balanceOf(c.addr()), 0);
    }

    function test_revertsWhenGuaranteeIsNotBelowCircleSize() public {
        vm.prank(holders[0]);
        vm.expectRevert(Giliran.BadTerms.selector);
        giliran.createCircle("ayu", labels, DUE, PERIOD, uint64(block.timestamp + 1 hours), false, 4);
    }
}

contract SizeTest is BaseTest {
    function test_allowsUpToTwentyFiveMembers() public {
        string[] memory many = new string[](25);
        for (uint256 i; i < 25; i++) {
            many[i] = string(abi.encodePacked("m", vm.toString(i)));
            ids.setOwner(many[i], makeAddr(many[i]));
        }
        vm.prank(makeAddr("m0"));
        CircleRef c = new CircleRef(giliran, giliran.createCircle("m0", many, DUE, PERIOD, uint64(block.timestamp + 1 hours), true, 3));
        assertEq(c.size(), 25);
        assertTrue(c.drawMode());
        assertEq(c.guaranteeDues(), 3);
    }
}
