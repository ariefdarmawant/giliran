// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAgentID {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title Giliran
/// @notice Rotating savings circles between Binance Agent ID `.ai` names, all in one contract.
/// - A seat is a name: only the wallet holding a member's name can pay into that seat.
/// - Joining is paying: a member's first payment, before `startAt`, takes their seat. A circle runs once every
///   member has joined; if not, anyone may `cancel` it after `startAt` and every joiner is repaid.
/// - Round r is due at `startAt + r * period`, or as soon as everyone has paid it (round 0: once everyone has
///   joined). It pays the round's money to whoever holds the recipient's name. In draw mode the recipient is
///   drawn from a block hash that did not exist when the draw was scheduled.
/// - Closing needs no extra step: every payment closes the round it makes due (the payment that fills a round
///   pays it out; the first payment after a deadline closes the overdue round). `close` lets anyone close a due
///   round nobody pays into.
/// - Guarantee: part of each payout pays that member's next dues at once, so a member who leaves after their
///   turn has already paid them. Those rounds count the member as paid, so they can still fill early.
/// - Late: a payment goes to the oldest round the member has not paid while that round is open. Dues skipped
///   before a member's own turn are taken from their payout and sent to the members who were short.
/// - Each name's record (paid, missed, missed after receiving, circles completed) is kept against the name.
/// @dev No owner, no admin, no fees, no upgrade path. USDT leaves only as a round payout to the recipient
/// name's holder, dues recovered for a member who was short, or a refund when a circle did not fill. Every write is a call from a
/// member's own wallet (or anyone, for `close` and `cancel`), so every interaction is with this one contract.
contract Giliran {
    using SafeERC20 for IERC20;

    IAgentID public constant AGENT_ID = IAgentID(0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F);
    uint256 public constant MIN_MEMBERS = 3;
    uint256 public constant MAX_MEMBERS = 25;
    uint256 public constant MIN_CONTRIBUTION = 0.01e18; // 0.01 USDT (18 decimals on BNB Chain)
    uint256 public constant MAX_CONTRIBUTION = 100e18; // 100 USDT
    uint64 public constant MIN_PERIOD = 1 hours;
    uint64 public constant MAX_PERIOD = 90 days; // with MAX_START_DELAY, bounds how long any due can sit unpaid out
    uint64 public constant MAX_START_DELAY = 30 days;
    uint256 public constant DRAW_DELAY = 3; // blocks between scheduling a draw and reading its hash
    /// A draw finished late reads `target + k * DRAW_WINDOW`, the latest such block at least DRAW_DELAY old, so it
    /// is always inside BSC's block hash history, whose window is 8,191 blocks (0x1fff in its bytecode; checked on
    /// chain 2026-11-25: 8,191 back answers, 8,192 reverts), so at most 8,002 blocks back leaves a margin.
    uint256 public constant DRAW_WINDOW = 8000;
    /// EIP-2935 block hash history (live on BSC): serves about 8,191 past block hashes, about an hour at BSC's
    /// ~0.45 s blocks, where `blockhash` serves 256 (under two minutes).
    address public constant BLOCK_HASH_HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;

    struct Circle {
        bytes32 organizerHash;
        uint256 contribution;
        uint64 period;
        uint64 startAt;
        bool drawMode;
        uint8 guaranteeDues;
        bool cancelled;
        uint256 joinedCount;
        uint256 closedRounds;
        string[] labels;
        bytes32[] hashes;
        mapping(bytes32 => uint256) seat; // name hash => member index + 1
        mapping(uint256 => bool) joined;
        mapping(uint256 => mapping(uint256 => bool)) paid; // round => member => paid by the member
        mapping(uint256 => mapping(uint256 => bool)) covered; // round => member => paid from their guarantee
        mapping(uint256 => mapping(uint256 => bool)) recovered; // round => member => missed, then taken from their payout
        mapping(uint256 => uint256) potOf;
        mapping(uint256 => uint256) paidCount;
        mapping(uint256 => uint256) drawBlockOf;
        mapping(uint256 => uint256) recipientOf;
        mapping(uint256 => bool) received;
        mapping(uint256 => uint256) payoutOf; // round => what its recipient received
        mapping(uint256 => uint256) nextRound; // member => earliest round they have not paid
        mapping(uint256 => uint256) misses;
        mapping(uint256 => address) lastPayer;
    }

    struct Record {
        uint32 roundsPaid;
        uint32 roundsMissed;
        uint32 missedAfterPot; // missed a round after already receiving a payout
        uint32 circlesCompleted; // finished a circle with no misses
    }

    IERC20 public immutable TOKEN;
    Circle[] internal _circles;
    mapping(bytes32 => Record) internal _records;

    // Counters for the proof page. Every payer held the member's name when paying.
    uint256 public payers; // distinct wallets that have paid
    uint256 public payments;
    uint256 public paidIn;
    uint256 public roundsClosed;
    mapping(address => bool) public hasPaid;

    event CircleCreated(
        uint256 indexed id,
        bytes32 indexed organizerHash,
        string organizer,
        string[] members,
        uint256 contribution,
        uint64 period,
        uint64 startAt,
        bool drawMode,
        uint8 guaranteeDues
    );
    event Joined(uint256 indexed id, uint256 indexed member, string label, address payer);
    event Paid(uint256 indexed id, uint256 indexed round, uint256 indexed member, address payer, uint256 amount);
    event Covered(uint256 indexed id, uint256 indexed round, uint256 indexed member, uint256 amount);
    event Recovered(uint256 indexed id, uint256 indexed round, uint256 indexed member, address to, uint256 amount);
    event Refunded(uint256 indexed id, address indexed payer, uint256 amount);
    event DrawScheduled(uint256 indexed id, uint256 indexed round, uint256 drawBlock);
    event Closed(uint256 indexed id, uint256 indexed round, string recipient, address paidTo, uint256 pot, uint256 heldBack);
    event Cancelled(uint256 indexed id, uint256 joiners);
    event Recorded(bytes32 indexed labelHash, uint256 indexed id, bool paid, bool afterPot);
    event Completed(bytes32 indexed labelHash, uint256 indexed id);

    error NoCircle();
    error NotNameOwner();
    error NotMember();
    error BadSize();
    error DuplicateMember();
    error UnknownName();
    error BadTerms();
    error AlreadyJoined();
    error Full();
    error NotActive();
    error NotStarted();
    error NotDue();
    error WrongRound();
    error DrawPending();
    error AllRoundsPaid();

    constructor(IERC20 token) {
        TOKEN = token;
    }

    // ---- writes ----

    /// @notice Start a circle. The caller must hold `organizer`, which must be one of `members`. Creating
    /// takes no money: every member, the organizer included, joins by paying their first payment.
    /// @param drawMode true: each round's recipient is drawn; false: paid out in the order given.
    /// @param guaranteeDues dues taken from each payout to pay the recipient's next dues at once (the guarantee).
    function createCircle(
        string calldata organizer,
        string[] calldata members,
        uint256 contribution,
        uint64 period,
        uint64 startAt,
        bool drawMode,
        uint8 guaranteeDues
    ) external returns (uint256 id) {
        bytes32 orgHash = keccak256(bytes(organizer));
        if (_ownerOf(orgHash) != msg.sender) revert NotNameOwner();
        uint256 n = members.length;
        if (n < MIN_MEMBERS || n > MAX_MEMBERS) revert BadSize();
        if (contribution < MIN_CONTRIBUTION || contribution > MAX_CONTRIBUTION || period < MIN_PERIOD || period > MAX_PERIOD
            || startAt <= block.timestamp || startAt > block.timestamp + MAX_START_DELAY || guaranteeDues >= n) revert BadTerms();

        id = _circles.length;
        Circle storage c = _circles.push();
        for (uint256 i; i < n; i++) {
            bytes32 h = keccak256(bytes(members[i]));
            if (_ownerOf(h) == address(0)) revert UnknownName();
            if (c.seat[h] != 0) revert DuplicateMember();
            c.seat[h] = i + 1;
            c.labels.push(members[i]);
            c.hashes.push(h);
        }
        if (c.seat[orgHash] == 0) revert NotMember();
        c.organizerHash = orgHash;
        c.contribution = contribution;
        c.period = period;
        c.startAt = startAt;
        c.drawMode = drawMode;
        c.guaranteeDues = guaranteeDues;
        emit CircleCreated(id, orgHash, organizer, members, contribution, period, startAt, drawMode, guaranteeDues);
    }

    /// @notice Pay one payment for `label`'s seat, from the wallet that holds the name. Before `startAt` this is
    /// how the member joins (round 0); after it, it pays the oldest round they have not paid that is still open
    /// (late but before the round closes still counts for it). Pulls exactly
    /// `contribution` USDT from the caller, who must have approved this contract for it.
    function pay(uint256 id, string calldata label) external {
        Circle storage c = _get(id);
        bytes32 h = keccak256(bytes(label));
        uint256 seat = c.seat[h];
        if (seat == 0) revert NotMember();
        if (_ownerOf(h) != msg.sender) revert NotNameOwner();
        if (c.cancelled) revert NotActive();
        uint256 i = seat - 1;
        uint256 n = c.hashes.length;
        if (block.timestamp < c.startAt) {
            if (c.joined[i]) revert AlreadyJoined(); // one payment per member before the start
            c.joined[i] = true;
            c.joinedCount++;
            emit Joined(id, i, label, msg.sender);
        } else if (c.joinedCount != n) {
            revert NotActive(); // never filled: waiting for cancel
        }
        uint256 r = _max(c.nextRound[i], c.closedRounds);
        if (r >= n) revert AllRoundsPaid();

        uint256 amount = c.contribution;
        c.paid[r][i] = true;
        c.potOf[r] += amount;
        c.paidCount[r]++;
        c.nextRound[i] = r + 1;
        c.lastPayer[i] = msg.sender;
        payments++;
        paidIn += amount;
        if (!hasPaid[msg.sender]) {
            hasPaid[msg.sender] = true;
            payers++;
        }
        emit Paid(id, r, i, msg.sender, amount);
        TOKEN.safeTransferFrom(msg.sender, address(this), amount);

        // Then close the oldest open round if this payment made it due (one round per payment keeps gas bounded).
        uint256 open = c.closedRounds;
        if (_active(c) && open < n && _due(c, open)) _closeDue(c, id, open);
    }

    /// @notice Close round `r` once it is due (fully paid, or its deadline has passed). Anyone may call it;
    /// payments already close the rounds they make due, so this is for a round nobody pays into. In draw mode
    /// the first close schedules the draw and a later one (after DRAW_DELAY blocks) draws and pays.
    function close(uint256 id, uint256 r) external {
        Circle storage c = _get(id);
        if (!_active(c)) revert NotActive();
        if (r != c.closedRounds) revert WrongRound();
        if (!_due(c, r)) revert NotDue();
        if (!_closeDue(c, id, r)) revert DrawPending();
    }

    /// @notice After `startAt`, end a circle that never filled: every joiner's first payment goes back to the
    /// wallet that paid it. Anyone may call it.
    function cancel(uint256 id) external {
        Circle storage c = _get(id);
        if (block.timestamp < c.startAt) revert NotStarted();
        if (c.cancelled) revert NotActive();
        if (c.joinedCount == c.hashes.length) revert Full();
        c.cancelled = true;
        uint256 n = c.hashes.length;
        for (uint256 i; i < n; i++) {
            if (c.joined[i]) _refund(id, c.lastPayer[i], c.contribution); // before the start, joining is their only payment
        }
        emit Cancelled(id, c.joinedCount);
    }

    // ---- views ----

    function circleCount() external view returns (uint256) {
        return _circles.length;
    }

    function circleInfo(uint256 id)
        external
        view
        returns (
            uint256 contribution,
            uint64 period,
            uint64 startAt,
            bool drawMode,
            uint8 guaranteeDues,
            uint256 size,
            uint256 joinedCount,
            uint256 closedRounds,
            bool cancelled
        )
    {
        Circle storage c = _get(id);
        return (c.contribution, c.period, c.startAt, c.drawMode, c.guaranteeDues, c.hashes.length, c.joinedCount, c.closedRounds, c.cancelled);
    }

    function labels(uint256 id) external view returns (string[] memory) { return _get(id).labels; }
    function organizerHash(uint256 id) external view returns (bytes32) { return _get(id).organizerHash; }
    function active(uint256 id) external view returns (bool) { return _active(_get(id)); }
    function finished(uint256 id) external view returns (bool) { Circle storage c = _get(id); return c.closedRounds == c.hashes.length; }
    function currentRound(uint256 id) external view returns (uint256) { return _currentRound(_get(id)); }
    function deadlineOf(uint256 id, uint256 r) external view returns (uint256) { return _deadlineOf(_get(id), r); }
    function joined(uint256 id, uint256 i) external view returns (bool) { return _get(id).joined[i]; }
    function paid(uint256 id, uint256 r, uint256 i) external view returns (bool) { return _get(id).paid[r][i]; }
    function covered(uint256 id, uint256 r, uint256 i) external view returns (bool) { return _get(id).covered[r][i]; }
    function recovered(uint256 id, uint256 r, uint256 i) external view returns (bool) { return _get(id).recovered[r][i]; }
    function potOf(uint256 id, uint256 r) external view returns (uint256) { return _get(id).potOf[r]; }
    function paidCount(uint256 id, uint256 r) external view returns (uint256) { return _get(id).paidCount[r]; }
    function drawBlockOf(uint256 id, uint256 r) external view returns (uint256) { return _get(id).drawBlockOf[r]; }
    function recipientOf(uint256 id, uint256 r) external view returns (uint256) { return _get(id).recipientOf[r]; }
    function received(uint256 id, uint256 i) external view returns (bool) { return _get(id).received[i]; }
    function payoutOf(uint256 id, uint256 r) external view returns (uint256) { return _get(id).payoutOf[r]; }
    /// @notice Whether `label`.ai is a claimed Agent ID. A yes or no only: nothing here maps a name to a wallet.
    function claimed(string calldata label) external view returns (bool) { return _ownerOf(keccak256(bytes(label))) != address(0); }
    function organizerOf(uint256 id) external view returns (string memory) {
        Circle storage c = _get(id);
        return c.labels[c.seat[c.organizerHash] - 1];
    }

    /// @notice The block whose hash draws a round scheduled for `target`, when drawn at block `at`: the target
    /// itself, or for a draw finished late the latest `target + k * DRAW_WINDOW` at least DRAW_DELAY blocks old.
    /// Every candidate is after the block that scheduled the draw, so nobody knew its hash then.
    function drawSourceBlock(uint256 target, uint256 at) public pure returns (uint256) {
        if (at <= target + DRAW_DELAY) return target;
        return target + ((at - DRAW_DELAY - target) / DRAW_WINDOW) * DRAW_WINDOW;
    }

    /// @notice A name's payment record across every circle.
    function recordOf(bytes32 labelHash)
        public
        view
        returns (uint32 roundsPaid, uint32 roundsMissed, uint32 missedAfterPot, uint32 circlesCompleted)
    {
        Record memory r = _records[labelHash];
        return (r.roundsPaid, r.roundsMissed, r.missedAfterPot, r.circlesCompleted);
    }

    function recordOfName(string calldata label) external view returns (uint32, uint32, uint32, uint32) {
        return recordOf(keccak256(bytes(label)));
    }

    /// @notice What the proof page shows, in one call.
    function stats() external view returns (uint256 circles, uint256 payers_, uint256 payments_, uint256 paidIn_, uint256 rounds) {
        return (_circles.length, payers, payments, paidIn, roundsClosed);
    }

    // ---- internals ----

    function _get(uint256 id) internal view returns (Circle storage) {
        if (id >= _circles.length) revert NoCircle();
        return _circles[id];
    }

    function _active(Circle storage c) internal view returns (bool) {
        return c.joinedCount == c.hashes.length && !c.cancelled;
    }

    /// @dev The round a payment made now is for: round 0 before the start, then the next round.
    function _currentRound(Circle storage c) internal view returns (uint256) {
        if (block.timestamp < c.startAt) return 0;
        return (block.timestamp - c.startAt) / c.period + 1;
    }

    function _deadlineOf(Circle storage c, uint256 r) internal view returns (uint256) {
        return c.startAt + r * c.period;
    }

    /// @dev Round r of an active circle can close: everyone has paid it, or its deadline has passed. Round 0 is
    /// fully paid once the circle is active, since joining pays it.
    function _due(Circle storage c, uint256 r) internal view returns (bool) {
        return c.paidCount[r] == c.hashes.length || block.timestamp >= _deadlineOf(c, r);
    }

    /// @dev Close due round r. Draw mode: schedule the draw, or draw and pay once its block has passed; false
    /// while the draw block is not mined yet. The last round has one member left, so it needs no draw.
    function _closeDue(Circle storage c, uint256 id, uint256 r) internal returns (bool) {
        uint256 who = r;
        if (c.drawMode) {
            bytes32 bh;
            if (r + 1 < c.hashes.length) {
                uint256 target = c.drawBlockOf[r];
                if (target == 0) return _schedule(c, id, r);
                if (block.number <= target) return false;
                bh = _hashOf(drawSourceBlock(target, block.number));
                if (bh == bytes32(0)) return _schedule(c, id, r); // no hash history at all: draw again, never from zero
            }
            who = _pick(c, bh, id, r);
        }
        _settle(c, id, r, who);
        return true;
    }

    /// @dev The hash of block `b`: from `blockhash` while it is among the last 256 blocks, then from the EIP-2935
    /// history contract, so nobody can force a redraw by waiting a couple of minutes. Zero once neither has it.
    function _hashOf(uint256 b) internal view returns (bytes32 h) {
        h = blockhash(b);
        if (h != bytes32(0)) return h;
        (bool ok, bytes memory ret) = BLOCK_HASH_HISTORY.staticcall(abi.encode(b));
        if (ok && ret.length == 32) h = abi.decode(ret, (bytes32));
    }

    function _schedule(Circle storage c, uint256 id, uint256 r) internal returns (bool) {
        uint256 target = block.number + DRAW_DELAY;
        c.drawBlockOf[r] = target;
        emit DrawScheduled(id, r, target);
        return true;
    }

    /// @dev Uniform pick among members who have not received, from a hash unknown when the round closed.
    function _pick(Circle storage c, bytes32 h, uint256 id, uint256 r) internal view returns (uint256) {
        uint256 n = c.hashes.length;
        uint256 k = uint256(keccak256(abi.encode(h, id, r, address(this)))) % (n - r);
        for (uint256 i; i < n; i++) {
            if (c.received[i]) continue;
            if (k == 0) return i;
            k--;
        }
        revert(); // unreachable: n - r members have not received
    }

    function _settle(Circle storage c, uint256 id, uint256 r, uint256 who) internal {
        uint256 n = c.hashes.length;
        uint256 due = c.contribution;
        c.closedRounds = r + 1;
        c.recipientOf[r] = who;
        roundsClosed++;

        uint256 pot = c.potOf[r];
        uint256 held = 0; // the recipient's next dues paid from this payout
        // Agent ID names cannot be moved or burned, so a name that does not resolve means the registry call failed:
        // pay the wallet that last paid for this seat, which held the name then. Every member has paid (joining).
        address to = _holderOf(c, who);
        for (uint256 i; i < n; i++) {
            bool p = c.paid[r][i] || c.covered[r][i]; // paid from an earlier payout is paid on time
            if (!p) c.misses[i]++;
            _record(c.hashes[i], id, p, !p && c.received[i]);
        }
        c.received[who] = true;

        // the guarantee: pay `who`'s next unpaid dues from this payout now, up to guaranteeDues of them
        uint256 next = _max(c.nextRound[who], r + 1);
        for (uint256 k; k < c.guaranteeDues && next < n && held + due <= pot; k++) {
            c.covered[next][who] = true;
            c.potOf[next] += due;
            c.paidCount[next]++;
            held += due;
            emit Covered(id, next, who, due);
            next++;
        }
        if (held > 0) c.nextRound[who] = next;
        uint256 keep = pot - held;
        // dues `who` skipped before this turn: taken from this payout, one due to each round that was short
        for (uint256 j; j < r && keep >= due; j++) {
            if (c.paid[j][who] || c.covered[j][who] || c.recovered[j][who]) continue;
            c.recovered[j][who] = true;
            keep -= due;
            address owed = _holderOf(c, c.recipientOf[j]);
            TOKEN.safeTransfer(owed, due);
            emit Recovered(id, j, who, owed, due);
        }
        c.payoutOf[r] = keep;
        if (keep > 0) TOKEN.safeTransfer(to, keep);
        emit Closed(id, r, c.labels[who], to, pot, held);

        if (r + 1 == n) _finish(c, id);
    }

    function _finish(Circle storage c, uint256 id) internal {
        uint256 n = c.hashes.length;
        for (uint256 i; i < n; i++) {
            if (c.misses[i] == 0) {
                _records[c.hashes[i]].circlesCompleted++;
                emit Completed(c.hashes[i], id);
            }
        }
    }

    function _record(bytes32 labelHash, uint256 id, bool paid_, bool afterPot) internal {
        Record storage rec = _records[labelHash];
        if (paid_) {
            rec.roundsPaid++;
        } else {
            rec.roundsMissed++;
            if (afterPot) rec.missedAfterPot++;
        }
        emit Recorded(labelHash, id, paid_, afterPot);
    }

    function _refund(uint256 id, address payer, uint256 amount) internal {
        TOKEN.safeTransfer(payer, amount);
        emit Refunded(id, payer, amount);
    }

    /// @dev Member i's wallet: whoever holds their name now, or the wallet that last paid for them.
    function _holderOf(Circle storage c, uint256 i) internal view returns (address a) {
        a = _ownerOf(c.hashes[i]);
        if (a == address(0)) a = c.lastPayer[i];
    }

    function _ownerOf(bytes32 labelHash) internal view returns (address) {
        try AGENT_ID.ownerOf(uint256(labelHash)) returns (address o) {
            return o;
        } catch {
            return address(0);
        }
    }

    function _max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }
}
