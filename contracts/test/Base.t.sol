// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Giliran} from "../src/Giliran.sol";
import {CircleRef} from "./CircleRef.sol";
import {MockUSDT, MockAgentID} from "./mocks/Mocks.sol";

/// Shared setup: a mock Agent ID registry etched at its real address, a mock USDT, four member names.
abstract contract BaseTest is Test {
    address constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    uint256 constant DUE = 2e18; // 2 USDT
    uint64 constant PERIOD = 1 days;

    MockUSDT usdt;
    MockAgentID ids;
    Giliran giliran;

    string[] labels;
    address[] holders;
    address organizer; // holds "org", which is not a member
    mapping(CircleRef => uint256) internal _idOf; // read without an external call (vm.prank / expectRevert target the next call)

    function setUp() public virtual {
        vm.etch(AGENT_ID, address(new MockAgentID()).code);
        ids = MockAgentID(AGENT_ID);
        usdt = new MockUSDT();
        giliran = new Giliran(IERC20(address(usdt)));

        organizer = makeAddr("organizer");
        ids.setOwner("org", organizer);
        string[4] memory names = ["ayu", "budi", "citra", "dewi"];
        for (uint256 i; i < names.length; i++) {
            address h = makeAddr(names[i]);
            labels.push(names[i]);
            holders.push(h);
            ids.setOwner(names[i], h);
            usdt.mint(h, 100e18);
            vm.prank(h);
            usdt.approve(address(giliran), type(uint256).max);
        }
    }

    /// ayu (a member) organizes. Fixed order, no guarantee, starts in an hour.
    function _create() internal returns (CircleRef c) {
        return _createWith(false, 0);
    }

    function _createWith(bool draw, uint8 guaranteeDues) internal returns (CircleRef c) {
        vm.prank(holders[0]);
        uint256 id = giliran.createCircle("ayu", labels, DUE, PERIOD, uint64(block.timestamp + 1 hours), draw, guaranteeDues);
        c = new CircleRef(giliran, id);
        _idOf[c] = id;
    }

    /// Everyone joins by paying their first payment (round 0), then time reaches the first round.
    function _start(CircleRef c) internal {
        for (uint256 i; i < labels.length; i++) _pay(c, i);
        vm.warp(c.startAt());
    }

    function _createAndStart() internal returns (CircleRef c) {
        c = _create();
        _start(c);
    }

    /// Member i pays one payment, from the wallet that holds their name.
    function _pay(CircleRef c, uint256 i) internal {
        _payAs(c, holders[i], labels[i]);
    }

    /// Close round r unless a payment already closed it (the payment that fills a round closes it).
    function _closeIfOpen(CircleRef c, uint256 r) internal {
        if (c.closedRounds() == r) c.close(r);
    }

    function _payAs(CircleRef c, address payer, string memory label) internal {
        vm.prank(payer);
        giliran.pay(_idOf[c], label);
    }
}
