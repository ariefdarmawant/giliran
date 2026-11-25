// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {CircleRef} from "./CircleRef.sol";

/// Every member puts in the same total and takes out the same total. Three rules keep that true when
/// someone pays late or not at all:
/// 1. What the guarantee takes from a payout pays that member's next dues at once: those rounds are paid on
///    time, not missed.
/// 2. A late payment goes to the oldest round the member has not paid, while that round is still open.
/// 3. Dues a member skipped before their own turn are taken from their payout and sent to the members
///    who were short.
contract FairnessTest is BaseTest {
    function _balances() internal view returns (uint256[4] memory b) {
        for (uint256 i; i < 4; i++) b[i] = usdt.balanceOf(holders[i]);
    }

    /// Everyone except `skip` pays round r (round 0 was paid by joining), then round r closes at its deadline.
    function _round(CircleRef c, uint256 r, uint256 skip) internal {
        for (uint256 i; i < 4 && r > 0; i++) {
            if (i != skip && !c.paid(r, i) && !c.covered(r, i)) _pay(c, i);
        }
        vm.warp(c.deadlineOf(r));
        _closeIfOpen(c, r);
    }

    // 1. the guarantee is prepaid dues

    function test_aRoundPaidFromTheGuaranteeCountsAsPaid() public {
        CircleRef c = _createWith(false, 2);
        _start(c);
        _round(c, 0, type(uint256).max); // ayu receives; 2 dues held back
        _round(c, 1, 0); // ayu does not pay round 1 herself: her guarantee pays it
        (uint32 paid, uint32 missed, uint32 afterPot,) = giliran.recordOf(keccak256("ayu"));
        assertEq(paid, 2);
        assertEq(missed, 0);
        assertEq(afterPot, 0);
    }

    function test_fullGuaranteeMeansNothingMoreToPayAndNobodyLoses() public {
        CircleRef c = _createWith(false, 3); // full: every due left after your turn
        uint256[4] memory before = _balances();
        _start(c);
        _round(c, 0, type(uint256).max); // ayu: pot 4, 3 held, 1 paid out
        for (uint256 r = 1; r < 4; r++) _round(c, r, 0); // ayu never pays again
        assertTrue(c.finished());
        uint256[4] memory afterAll = _balances();
        for (uint256 i; i < 4; i++) assertEq(afterAll[i], before[i]); // each put in 4 dues and took out 4
        assertEq(usdt.balanceOf(c.addr()), 0);
        (,,, uint32 done) = giliran.recordOf(keccak256("ayu"));
        assertEq(done, 1); // finished with no misses
    }

    // 2. a late payment goes to the round still open

    function test_aLatePaymentCountsForTheRoundStillOpen() public {
        CircleRef c = _createAndStart();
        for (uint256 i; i < 3; i++) _pay(c, i); // dewi has not paid round 1
        vm.warp(c.deadlineOf(1) + 1 hours); // past the deadline; nobody has closed round 1 yet
        _pay(c, 3); // counts for round 1, then closes it
        assertTrue(c.paid(1, 3));
        assertFalse(c.paid(2, 3));
        assertEq(c.closedRounds(), 2);
    }

    // 3. dues skipped before your turn come out of your payout

    function test_aMissBeforeYourTurnIsTakenFromYourPayout() public {
        CircleRef c = _create(); // fixed order: ayu, budi, citra, dewi
        uint256[4] memory before = _balances(); // before anyone joins: each puts in 4 dues and takes out 4
        _start(c);
        _round(c, 0, type(uint256).max);
        _round(c, 1, 3); // dewi skips budi's round: budi gets 3 dues, not 4
        _round(c, 2, type(uint256).max);
        _round(c, 3, type(uint256).max); // dewi's turn: 4 dues in, 1 owed to budi
        uint256[4] memory afterAll = _balances();
        assertEq(afterAll[1], before[1]); // budi made whole
        assertEq(afterAll[3], before[3]); // dewi paid 3 dues and kept 3
        assertEq(usdt.balanceOf(c.addr()), 0);
        assertTrue(c.recovered(1, 3));
    }

    /// Any pattern of dues skipped before each member's own turn: everyone still ends where they started.
    function testFuzz_skipsBeforeYourTurnLeaveEveryoneWhole(uint8 mask) public {
        CircleRef c = _create(); // fixed order: member i receives round i
        uint256[4] memory before = _balances();
        _start(c);
        for (uint256 r; r < 4; r++) {
            for (uint256 i; i < 4 && r > 0; i++) {
                bool skip = r < i && (mask >> ((i * 4 + r) % 8)) & 1 == 1; // only rounds before i's own turn
                if (!skip) _pay(c, i);
            }
            vm.warp(c.deadlineOf(r));
            _closeIfOpen(c, r);
        }
        uint256[4] memory afterAll = _balances();
        for (uint256 i; i < 4; i++) assertEq(afterAll[i], before[i]);
        assertEq(usdt.balanceOf(c.addr()), 0);
    }
}
