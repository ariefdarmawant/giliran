// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Giliran} from "../src/Giliran.sol";

/// Test-only view of one circle inside Giliran, so circle tests read like they address a circle.
/// Writes that need the caller to be a member (`pay`) go through Giliran directly in the tests.
contract CircleRef {
    Giliran public immutable g;
    uint256 public immutable id;

    constructor(Giliran g_, uint256 id_) {
        g = g_;
        id = id_;
    }

    function addr() external view returns (address) { return address(g); }
    function close(uint256 r) external { g.close(id, r); }
    function cancel() external { g.cancel(id); }

    function contribution() external view returns (uint256 v) { (v,,,,,,,,) = g.circleInfo(id); }
    function period() external view returns (uint64 v) { (, v,,,,,,,) = g.circleInfo(id); }
    function startAt() external view returns (uint64 v) { (,, v,,,,,,) = g.circleInfo(id); }
    function drawMode() external view returns (bool v) { (,,, v,,,,,) = g.circleInfo(id); }
    function guaranteeDues() external view returns (uint8 v) { (,,,, v,,,,) = g.circleInfo(id); }
    function size() external view returns (uint256 v) { (,,,,, v,,,) = g.circleInfo(id); }
    function joinedCount() external view returns (uint256 v) { (,,,,,, v,,) = g.circleInfo(id); }
    function closedRounds() external view returns (uint256 v) { (,,,,,,, v,) = g.circleInfo(id); }
    function cancelled() external view returns (bool v) { (,,,,,,,, v) = g.circleInfo(id); }
    function active() external view returns (bool) { return g.active(id); }
    function finished() external view returns (bool) { return g.finished(id); }
    function currentRound() external view returns (uint256) { return g.currentRound(id); }
    function deadlineOf(uint256 r) external view returns (uint256) { return g.deadlineOf(id, r); }
    function joined(uint256 i) external view returns (bool) { return g.joined(id, i); }
    function paid(uint256 r, uint256 i) external view returns (bool) { return g.paid(id, r, i); }
    function covered(uint256 r, uint256 i) external view returns (bool) { return g.covered(id, r, i); }
    function recovered(uint256 r, uint256 i) external view returns (bool) { return g.recovered(id, r, i); }
    function potOf(uint256 r) external view returns (uint256) { return g.potOf(id, r); }
    function paidCount(uint256 r) external view returns (uint256) { return g.paidCount(id, r); }
    function drawBlockOf(uint256 r) external view returns (uint256) { return g.drawBlockOf(id, r); }
    function recipientOf(uint256 r) external view returns (uint256) { return g.recipientOf(id, r); }
    function received(uint256 i) external view returns (bool) { return g.received(id, i); }
    function payoutOf(uint256 r) external view returns (uint256) { return g.payoutOf(id, r); }
    function DRAW_DELAY() external view returns (uint256) { return g.DRAW_DELAY(); }
}
