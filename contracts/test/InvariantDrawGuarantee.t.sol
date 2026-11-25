// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Giliran} from "../src/Giliran.sol";
import {CircleRef} from "./CircleRef.sol";
import {BaseTest} from "./Base.t.sol";

/// Random payments, misses, time and block jumps, scheduled and settled draws, on a circle with
/// kocokan and two dues of guarantee.
contract DrawGuaranteeHandler is Test {
    CircleRef public c;
    IERC20 public usdt;
    address[] public holders;
    string[] public labels;
    uint256 public ghostIn;
    uint256 public ghostOut;

    constructor(CircleRef c_, IERC20 usdt_, address[] memory holders_, string[] memory labels_) {
        c = c_;
        usdt = usdt_;
        holders = holders_;
        labels = labels_;
        ghostIn = usdt_.balanceOf(c_.addr()); // what joining left in (round 0 pays out at the last join)
    }

    function pay(uint256 who) external {
        who = bound(who, 0, holders.length - 1);
        uint256 amount = c.contribution();
        uint256 before = usdt.balanceOf(c.addr());
        (Giliran g, uint256 id) = (c.g(), c.id());
        vm.prank(holders[who]);
        uint256 closed = c.closedRounds();
        try g.pay(id, labels[who]) {
            ghostIn += amount;
            uint256 after_ = usdt.balanceOf(c.addr());
            if (c.closedRounds() == closed) {
                assertEq(after_ - before, amount); // closed nothing: only the payment came in
            } else {
                ghostOut += before + amount - after_; // the payment closed a round and paid it out
            }
        } catch {
            assertEq(usdt.balanceOf(c.addr()), before);
        }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    /// Moves blocks forward; past 256 blocks a scheduled draw's hash expires and must be re-drawn.
    function roll(uint256 blocks) external {
        vm.roll(block.number + bound(blocks, 1, 400));
    }

    function close() external {
        uint256 r = c.closedRounds();
        if (r >= c.size()) return;
        if (c.paidCount(r) < c.size() && block.timestamp < c.deadlineOf(r)) return;
        uint256 target = c.drawBlockOf(r);
        if (target != 0 && block.number <= target) return;
        if (target != 0) {
            uint256 src = c.g().drawSourceBlock(target, block.number);
            vm.setBlockhash(src, keccak256(abi.encode("draw", src)));
        }
        uint256 before = usdt.balanceOf(c.addr());
        c.close(r);
        ghostOut += before - usdt.balanceOf(c.addr());
    }
}

contract DrawGuaranteeInvariantTest is BaseTest {
    DrawGuaranteeHandler handler;
    CircleRef c;

    function setUp() public override {
        super.setUp();
        c = _createWith(true, 2);
        _start(c);
        handler = new DrawGuaranteeHandler(c, IERC20(address(usdt)), holders, labels);
        targetContract(address(handler));
    }

    function invariant_solventWithGuarantees() public view {
        assertEq(handler.ghostIn(), handler.ghostOut() + usdt.balanceOf(c.addr()));
    }

    /// Held funds are exactly the open rounds' money (dues prepaid from a payout are in those rounds' pots).
    function invariant_heldEqualsOpenPots() public view {
        uint256 held;
        for (uint256 r = c.closedRounds(); r < c.size(); r++) held += c.potOf(r);
        assertEq(usdt.balanceOf(c.addr()), held);
    }

    /// Nobody receives twice, and only closed rounds have recipients.
    function invariant_eachMemberReceivesAtMostOnce() public view {
        uint256 receivers;
        for (uint256 i; i < c.size(); i++) if (c.received(i)) receivers++;
        assertEq(receivers, c.closedRounds());
    }
}
