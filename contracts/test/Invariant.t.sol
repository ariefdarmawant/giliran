// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Giliran} from "../src/Giliran.sol";
import {CircleRef} from "./CircleRef.sol";
import {BaseTest} from "./Base.t.sol";

/// Drives a running circle with random payments (right and wrong amounts), time jumps and closes.
contract CircleHandler is Test {
    CircleRef public c;
    IERC20 public usdt;
    address[] public holders;
    string[] public labels;

    uint256 public ghostIn; // paid into the circle
    uint256 public ghostOut; // left the circle (pots + refunds)
    uint256 public potsPaid;

    constructor(CircleRef c_, IERC20 usdt_, address[] memory holders_, string[] memory labels_) {
        c = c_;
        usdt = usdt_;
        holders = holders_;
        labels = labels_;
        ghostIn = usdt_.balanceOf(c_.addr()); // what joining left in (round 0 pays out at the last join)
        potsPaid = c_.closedRounds();
    }

    /// A member pays, sometimes under someone else's name: a refused payment must move nothing.
    function pay(uint256 who, bool wrongName) external {
        who = bound(who, 0, holders.length - 1);
        address h = holders[who];
        string memory label = wrongName ? labels[(who + 1) % labels.length] : labels[who];
        uint256 amount = c.contribution();
        uint256 before = usdt.balanceOf(c.addr());
        uint256 payerBefore = usdt.balanceOf(h);
        (Giliran g, uint256 id) = (c.g(), c.id());
        vm.prank(h);
        uint256 closed = c.closedRounds();
        try g.pay(id, label) {
            ghostIn += amount;
            uint256 after_ = usdt.balanceOf(c.addr());
            if (c.closedRounds() == closed) {
                assertEq(after_ - before, amount); // closed nothing: only the payment came in
            } else {
                ghostOut += before + amount - after_; // the payment closed a round and paid it out
                potsPaid++;
            }
        } catch {
            // refused (someone else's name, every round prepaid, circle not running): nothing moved
            assertEq(usdt.balanceOf(c.addr()), before);
            assertEq(usdt.balanceOf(h), payerBefore);
        }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    function close() external {
        uint256 r = c.closedRounds();
        if (r >= c.size()) return;
        if (c.paidCount(r) < c.size() && block.timestamp < c.deadlineOf(r)) return;
        uint256 before = usdt.balanceOf(c.addr());
        c.close(r);
        ghostOut += before - usdt.balanceOf(c.addr());
        potsPaid++;
    }
}

contract CircleInvariantTest is BaseTest {
    CircleHandler handler;
    CircleRef c;

    function setUp() public override {
        super.setUp();
        c = _createAndStart();
        handler = new CircleHandler(c, IERC20(address(usdt)), holders, labels);
        targetContract(address(handler));
    }

    /// Nothing is created or lost.
    function invariant_solvent() public view {
        assertEq(handler.ghostIn(), handler.ghostOut() + usdt.balanceOf(c.addr()));
    }

    /// Each round pays out at most once, and rounds close in order.
    function invariant_roundsCloseOnce() public view {
        assertEq(handler.potsPaid(), c.closedRounds());
        assertLe(c.closedRounds(), c.size());
    }

    /// Held funds are exactly the pots of rounds not yet closed.
    function invariant_heldEqualsOpenPots() public view {
        uint256 open;
        for (uint256 r = c.closedRounds(); r < c.size(); r++) open += c.potOf(r);
        assertEq(usdt.balanceOf(c.addr()), open);
    }
}
