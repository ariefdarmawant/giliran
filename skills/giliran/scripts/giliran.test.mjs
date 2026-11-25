// node --test skills/giliran/scripts/  (no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCreate, encodePay, encodeClose, encodeCancel, encodeApprove, parseTerms, decodeStrings, TermsError, duesPlan } from './giliran.mjs';

// Reference calldata from `cast calldata` for the same arguments.
const CAST_CREATE = '0xeb6e9fdd00000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000008ac7230489e800000000000000000000000000000000000000000000000000000000000000278d0000000000000000000000000000000000000000000000000000000000713fb30000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000361797500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000361797500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004627564690000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000056369747261000000000000000000000000000000000000000000000000000000';
const CAST_PAY = '0x154fbbc40000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000046275646900000000000000000000000000000000000000000000000000000000';

const NOW = 1_800_000_000;
const args = (o) => ({ organizer: 'ayu', members: 'ayu,budi,citra', due: '10', every: 'monthly', order: 'draw', guarantee: '2', ...o });

test('createCircle calldata matches cast', () => {
  const t = parseTerms(args({ start: '1900000000' }), 1_900_000_000 - 86_400);
  assert.equal(encodeCreate(t), CAST_CREATE);
});

test('pay calldata matches cast', () => {
  assert.equal(encodePay(3n, 'budi'), CAST_PAY);
});

test('close, cancel and approve calldata', () => {
  assert.equal(encodeClose(1n, 2n), '0x596c8976' + '1'.padStart(64, '0') + '2'.padStart(64, '0'));
  assert.equal(encodeCancel(7n), '0x40e58ee5' + '7'.padStart(64, '0'));
  assert.equal(encodeApprove('0x' + 'ab'.repeat(20), 30n * 10n ** 18n), '0x095ea7b3' + 'ab'.repeat(20).padStart(64, '0') + (30n * 10n ** 18n).toString(16).padStart(64, '0'));
});

test('reads the site sentence fields, names with or without .ai', () => {
  const t = parseTerms(args({ organizer: 'Ayu.ai', members: 'ayu.ai, budi.ai,citra.ai', every: 'weekly', order: 'fixed', guarantee: 'full', start: String(NOW + 7200) }), NOW);
  assert.deepEqual(t, { organizer: 'ayu', members: ['ayu', 'budi', 'citra'], contribution: 10n * 10n ** 18n, period: 604800n, startAt: BigInt(NOW + 7200), drawMode: false, guaranteeDues: 2 });
});

test('default first round is two days on, on the hour', () => {
  const t = parseTerms(args(), NOW);
  assert.equal(Number(t.startAt) % 3600, 0);
  assert.ok(Number(t.startAt) >= NOW + 2 * 86400);
});

test('refuses what the contract would refuse, naming the field', () => {
  const field = (o) => { try { parseTerms(args(o), NOW); return 'ok'; } catch (e) { if (e instanceof TermsError) return e.field; throw e; } };
  assert.equal(field({ members: 'ayu,budi' }), 'members');
  assert.equal(field({ members: 'ayu,budi,bad name!' }), 'members');
  assert.equal(field({ members: 'ayu,ayu,budi' }), 'members');
  assert.equal(field({ organizer: 'dewi' }), 'organizer');
  assert.equal(field({ due: '0' }), 'due');
  assert.equal(field({ due: '101' }), 'due');
  assert.equal(field({ due: '0.009' }), 'due'); // under the 0.01 USDT minimum
  assert.equal(field({ due: '2.555' }), 'due'); // cents at most
  assert.equal(field({ every: 'hourly' }), 'every');
  assert.equal(field({ order: 'random' }), 'order');
  assert.equal(field({ guarantee: 'half' }), 'guarantee');
  assert.equal(field({ guarantee: '3' }), 'guarantee');
  assert.equal(field({ start: String(NOW + 60) }), 'start');
  assert.equal(field({ start: String(NOW + 30 * 86_400 + 1) }), 'start'); // the contract allows a start at most 30 days out
});

test('decodes a string[] return', () => {
  // labels(uint256) for ["ayu","budi"]
  const hex = '0x' + [
    '20', '2', '40', '80', '3', '617975'.padEnd(64, '0'), '4', '62756469'.padEnd(64, '0'),
  ].map((w) => (w.length === 64 ? w : w.padStart(64, '0'))).join('');
  assert.deepEqual(decodeStrings(hex), ['ayu', 'budi']);
});

// What a member still owes, mirroring the contract: a payment goes to the oldest round still open that the member
// has not paid; the guarantee pays a recipient's next dues at payout (on chain as `covered`); dues skipped before
// their turn come out of their payout.
const F5 = [false, false, false, false, false];
test('before their turn: next round to pay, dues left, and skipped dues taken from the payout', () => {
  const plan = duesPlan({ size: 5, closedRounds: 3, paid: [true, true, false, false, false], covered: F5, recovered: F5 });
  assert.deepEqual(plan, { nextRound: 3, payNow: true, toPay: 2, skipped: 1 });
});

test('after their turn the guarantee paid their next dues: nothing to pay now', () => {
  const plan = duesPlan({ size: 5, closedRounds: 3, paid: [true, true, true, false, false], covered: [false, false, false, true, true], recovered: F5 });
  assert.deepEqual(plan, { nextRound: 5, payNow: false, toPay: 0, skipped: 0 });
});

test('a partial guarantee: this round is paid for them, the rest is theirs to pay', () => {
  const plan = duesPlan({ size: 5, closedRounds: 1, paid: [true, false, false, false, false], covered: [false, true, false, false, false], recovered: F5 });
  assert.deepEqual(plan, { nextRound: 2, payNow: false, toPay: 3, skipped: 0 });
});

test('covered or recovered rounds are not skipped; everything paid means nothing left', () => {
  const plan = duesPlan({ size: 3, closedRounds: 2, paid: [true, false, true], covered: [false, true, false], recovered: [false, false, false] });
  assert.deepEqual(plan, { nextRound: 3, payNow: false, toPay: 0, skipped: 0 });
});

test('no guarantee unless asked: the whole pot goes to whoever\'s turn it is', () => {
  const t = parseTerms({ organizer: 'ayu', members: 'ayu,budi,citra', due: '10', every: 'daily', order: 'fixed', start: String(NOW + 7200) }, NOW);
  assert.equal(t.guaranteeDues, 0);
  assert.equal(parseTerms(args({ guarantee: 'none', start: String(NOW + 7200) }), NOW).guaranteeDues, 0);
});

// calendar (.ics) for a circle's deadlines
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { calendarIcs, GILIRAN } from './giliran.mjs';

const START = 1_900_000_000;
const cal = (o) => ({ circle: 1, contract: GILIRAN, labels: ['ayu', 'budi', 'citra'], period: 86_400, startAt: START, drawMode: false, due: '10 USDT', link: 'https://giliran-app.vercel.app/?c=1', now: START - 5 * 3600, lang: 'en', me: null, paid: [], closedRounds: 0, joinedCount: 1, ...o });
const stamp = (s) => new Date(s * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// unfold RFC 5545 continuation lines, then split each event into its own block
const events = (ics) => ics.replace(/\r\n /g, '').split('BEGIN:VEVENT').slice(1);
const field = (ev, k) => ev.split('\r\n').find((l) => l.startsWith(k + ':'))?.slice(k.length + 1);

test('calendar: one event per round deadline, at startAt + r * period, in UTC', () => {
  const ics = calendarIcs(cal());
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every line ends in CRLF');
  const ev = events(ics);
  assert.equal(ev.length, 3);
  ev.forEach((e, r) => {
    assert.equal(field(e, 'DTSTART'), stamp(START + r * 86_400));
    assert.equal(field(e, 'UID'), `giliran-${GILIRAN.toLowerCase()}-1-${r}@giliran-app.vercel.app`); // stable: importing again updates, never duplicates
  });
});

test('calendar: a member who has not joined is told to join by the first round', () => {
  const [first, second] = events(calendarIcs(cal()));
  assert.match(field(first, 'SUMMARY'), /^Giliran #1: last moment to join \(10 USDT\)$/);
  assert.match(field(first, 'DESCRIPTION'), /Join Giliran circle #1\./);
  assert.match(field(second, 'SUMMARY'), /^Giliran #1: round 2 dues close \(10 USDT\)$/);
  assert.match(field(second, 'DESCRIPTION'), /Pay my dues for Giliran circle #1\./);
});

test('calendar: fixed order names each round\'s recipient and marks my turn', () => {
  const ev = events(calendarIcs(cal({ me: 'budi', paid: [true], joinedCount: 3 })));
  assert.match(field(ev[0], 'SUMMARY'), /^Giliran #1: round 1 pays out$/);
  assert.deepEqual(events(calendarIcs(cal({ paid: [false, true] })))[1].match(/TRIGGER/g), null); // paid ahead: no reminder // joining paid round 1's due
  assert.match(field(ev[0], 'DESCRIPTION'), /goes to ayu\.ai/);
  assert.match(field(ev[1], 'SUMMARY'), /\\, your turn$/);
  assert.match(field(ev[1], 'DESCRIPTION'), /Your turn: this round's pot comes to you/);
  assert.doesNotMatch(field(ev[2], 'SUMMARY'), /your turn/);
});

test('calendar: draw mode does not promise a recipient', () => {
  const ev = events(calendarIcs(cal({ drawMode: true, me: 'budi' })));
  for (const e of ev) {
    assert.doesNotMatch(e, /your turn|goes to/i);
    assert.match(field(e, 'DESCRIPTION'), /drawn after the round closes/);
  }
});

test('calendar: reminders when a round opens, a day before and an hour before', () => {
  const trig = (e) => e.split('\r\n').filter((l) => l.startsWith('TRIGGER:')).map((l) => l.slice(8));
  const daily = events(calendarIcs(cal()));
  assert.deepEqual(trig(daily[0]), ['-P1D', '-PT1H']);
  assert.deepEqual(trig(daily[1]), ['-P1D', '-PT1H']); // a daily round opens a day before it closes
  const monthly = events(calendarIcs(cal({ period: 30 * 86_400 })));
  assert.deepEqual(trig(monthly[0]), ['-P1D', '-PT1H']);
  assert.deepEqual(trig(monthly[1]), ['-P30D', '-P1D', '-PT1H']);
  const hourly = events(calendarIcs(cal({ period: 3600 })));
  assert.deepEqual(trig(hourly[1]), ['-PT1H', '-PT10M']);
  assert.deepEqual(trig(events(calendarIcs(cal({ paid: [true], joinedCount: 3 })))[0]), []); // nothing to do: everyone joined
});

test('calendar: past deadlines are left out; nothing left gives null', () => {
  assert.equal(events(calendarIcs(cal({ now: START + 3600, joinedCount: 3 }))).length, 2);
  assert.equal(events(calendarIcs(cal({ closedRounds: 2, joinedCount: 3 }))).length, 1); // closed early: everyone paid
  assert.equal(calendarIcs(cal({ now: START + 2 * 86_400, joinedCount: 3 })), null);
});

test('calendar: Indonesian text', () => {
  const ev = events(calendarIcs(cal({ lang: 'id', me: 'budi', paid: [true] })));
  assert.match(field(ev[1], 'SUMMARY'), /^Giliran #1: iuran putaran 2 ditutup \(10 USDT\)\\, giliranmu$/); // commas are escaped in iCalendar text
  assert.match(field(ev[1], 'DESCRIPTION'), /Bayar iuran arisan Giliran #1\./);
});

test('calendar: text is escaped and lines fold at 75 octets', () => {
  const ics = calendarIcs(cal({ link: 'https://giliran-app.vercel.app/?c=1&lang=en' }));
  for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75, l);
  const d = field(events(ics)[1], 'DESCRIPTION');
  assert.match(d, /\\n/); // paragraph breaks are escaped newlines
  assert.match(d, /If everyone pays early\\, the round/); // commas are escaped
  assert.doesNotMatch(d.replace(/\\[\\,;n]/g, ''), /[,;]/);
});

test('calendar: the site builds the identical file', () => {
  const box = { window: {} };
  runInNewContext(readFileSync(new URL('../../../site/calendar.js', import.meta.url), 'utf8'), box);
  for (const o of [cal(), cal({ me: 'budi', paid: [true], lang: 'id' }), cal({ drawMode: true, period: 7 * 86_400 })]) {
    assert.equal(box.window.GiliranCalendar(o), calendarIcs(o));
  }
});

// inbox: what a member has to do in one circle
import { inboxEntry } from './giliran.mjs';

const DAY = 86_400;
const circ = (o) => ({ size: 3, startAt: START, period: DAY, joinedCount: 1, closedRounds: 0, cancelled: false, drawMode: false, labels: ['ayu', 'budi', 'citra'], now: START - DAY, ...o });
const pl = (o) => ({ nextRound: 0, payNow: true, toPay: 3, skipped: 0, ...o });

test('inbox: invited and not joined: join before the first round', () => {
  assert.deepEqual(inboxEntry(circ(), 1, false, null), { action: 'join', round: 1, by: START, yourTurn: { round: 2, at: START + DAY } });
});

test('inbox: joined, waiting for the others; a circle that did not fill can be cancelled', () => {
  assert.equal(inboxEntry(circ(), 1, true, null).action, 'wait');
  assert.deepEqual(inboxEntry(circ({ now: START + 60 }), 1, true, null), { action: 'cancel' });
  assert.equal(inboxEntry(circ({ now: START + 60 }), 1, false, null), null); // never joined: nothing of theirs is in it
});

test('inbox: a running circle: pay the open round, late after its deadline, or paid up until the next', () => {
  const running = circ({ joinedCount: 3, closedRounds: 1, now: START + 60 });
  assert.deepEqual(inboxEntry(running, 1, true, pl({ nextRound: 1, toPay: 2 })), { action: 'pay', round: 2, by: START + DAY, late: false, yourTurn: { round: 2, at: START + DAY } });
  assert.equal(inboxEntry({ ...running, now: START + DAY + 60 }, 1, true, pl({ nextRound: 1 })).late, true);
  assert.deepEqual(inboxEntry(running, 2, true, pl({ nextRound: 2, payNow: true, toPay: 1 })), { action: 'paid', round: 3, by: START + 2 * DAY, yourTurn: { round: 3, at: START + 2 * DAY } });
});

test('inbox: nothing left to pay, a guarantee-paid round, draw mode, and finished circles', () => {
  const running = circ({ joinedCount: 3, closedRounds: 2, now: START + DAY + 60 });
  assert.deepEqual(inboxEntry(running, 0, true, pl({ nextRound: 3, payNow: false, toPay: 0 })), { action: 'done' });
  assert.equal(inboxEntry(running, 0, true, pl({ nextRound: 2, payNow: false, toPay: 1 })).action, 'covered');
  assert.equal(inboxEntry({ ...running, drawMode: true }, 2, true, pl({ nextRound: 2, toPay: 1 })).yourTurn, undefined);
  assert.equal(inboxEntry({ ...running, closedRounds: 3 }, 0, true, null), null);
  assert.equal(inboxEntry({ ...running, cancelled: true }, 0, true, null), null);
});

// exact approval: the allowance equals the dues still owed across all the user's circles
import { approvalPlan, settledRounds } from './giliran.mjs';

test('approval: set to the total owed in every circle, so running it twice changes nothing', () => {
  const U = 10n ** 18n;
  const owed = [{ circle: 1, amount: 30n * U }, { circle: 4, amount: 20n * U }];
  assert.deepEqual(approvalPlan(0n, owed), { target: 50n * U, ready: true });
  assert.deepEqual(approvalPlan(50n * U, owed), { target: 50n * U, ready: false }); // already exact: nothing to send
  assert.deepEqual(approvalPlan(100n * U, owed), { target: 50n * U, ready: true }); // too much (an older stacked approval): bring it down
  assert.deepEqual(approvalPlan(0n, []), { target: 0n, ready: false });
});

test('settled rounds: paid by the member, or paid from their payout (covered)', () => {
  assert.deepEqual(settledRounds({ paid: [true, true, false, false, false], covered: [false, false, true, true, false] }), [true, true, true, true, false]);
});

test('calendar: no reminders for a circle that did not fill by its first round, and no METHOD without an ORGANIZER', () => {
  assert.equal(calendarIcs(cal({ now: START + 60, joinedCount: 2 })), null);
  assert.ok(calendarIcs(cal({ joinedCount: 2 }))); // still joining: the join reminder stays
  assert.doesNotMatch(calendarIcs(cal()), /METHOD:/);
});

// chain reads: one batch request, retried with backoff, single calls where batches are refused
import { createServer } from 'node:http';
import { ethCalls } from './giliran.mjs';

/** A fake RPC: `mode` decides how it treats a request; every eth_call answers its data back as the result. */
async function fakeRpc(mode) {
  const seen = { batches: 0, singles: 0, refused: 0 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const q = JSON.parse(body);
      const one = (x) => ({ jsonrpc: '2.0', id: x.id, result: x.params[0].data });
      if (mode.limited && seen.refused < mode.limited) { seen.refused++; res.writeHead(429).end('slow down'); return; }
      if (Array.isArray(q)) {
        if (mode.noBatch) { seen.refused++; res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'batch not allowed' } })); return; }
        seen.batches++;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(q.map(one).reverse())); // answers may come in any order
      } else { seen.singles++; res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(one(q))); }
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}
const reads = (n) => [...Array(n).keys()].map((k) => ['0x' + '1'.repeat(40), '0x' + k.toString(16).padStart(8, '0')]);

test('reads: 45 calls go out as 3 batches and come back in order', async () => {
  const s = await fakeRpc({});
  const out = await ethCalls([s.url], reads(45));
  s.close();
  assert.equal(s.seen.batches, 3);
  assert.deepEqual(out, reads(45).map(([, d]) => d));
});

test('reads: an endpoint that refuses batches is asked one call at a time', async () => {
  const s = await fakeRpc({ noBatch: true });
  const out = await ethCalls([s.url], reads(3));
  s.close();
  assert.equal(s.seen.singles, 3);
  assert.deepEqual(out, reads(3).map(([, d]) => d));
});

test('reads: a rate-limited endpoint is retried after a pause', async () => {
  const s = await fakeRpc({ limited: 2 });
  const out = await ethCalls([s.url], reads(2));
  s.close();
  assert.equal(s.seen.refused, 2);
  assert.deepEqual(out, reads(2).map(([, d]) => d));
});

// a payment closes the round it makes due
import { roundState, afterPayment } from './giliran.mjs';

const R = { size: 3, closedRounds: 1, startAt: START, period: DAY, now: START + 60, drawMode: false, paid: 1, drawBlock: 0n, block: 100n };

test('round state: collecting until everyone paid or the deadline passed; draw mode waits for its block', () => {
  assert.equal(roundState(R), 'collecting');
  assert.equal(roundState({ ...R, paid: 3 }), 'due');
  assert.equal(roundState({ ...R, now: START + DAY }), 'due');
  assert.equal(roundState({ ...R, drawMode: true, paid: 3 }), 'due'); // nobody scheduled the draw yet
  assert.equal(roundState({ ...R, drawMode: true, paid: 3, drawBlock: 100n }), 'draw_pending');
  assert.equal(roundState({ ...R, drawMode: true, paid: 3, drawBlock: 99n }), 'draw_ready');
  assert.equal(roundState({ ...R, drawMode: true, closedRounds: 2, paid: 3, drawBlock: 0n }), 'due'); // last round: nothing to draw
  assert.equal(roundState({ ...R, closedRounds: 0, paid: 3, now: START - DAY }), 'due'); // round 0 once everyone joined
});

test('after a payment: what else it does, so the yes covers it', () => {
  const labels = ['ayu', 'budi', 'citra'];
  const due = 10; // USDT
  assert.equal(afterPayment({ ...R, labels, due, forRound: 1 }), null); // 2 of 3 after it
  const budi = { next: 1, skipped: 0 };
  assert.equal(afterPayment({ ...R, labels, due, paid: 2, forRound: 1, recipient: budi }), 'This payment completes round 2, so it also sends 30 USDT to budi.ai.');
  // with a guarantee, part of the pot pays budi's next due at once; a due budi skipped goes to whoever was short
  assert.equal(afterPayment({ ...R, labels, due, paid: 2, forRound: 1, guaranteeDues: 1, recipient: budi }),
    'This payment completes round 2, so it also sends 20 USDT to budi.ai. 10 USDT of the round pays budi.ai’s next due now (the guarantee).');
  assert.equal(afterPayment({ ...R, labels, due, paid: 2, forRound: 1, recipient: { next: 1, skipped: 1 } }),
    'This payment completes round 2, so it also sends 20 USDT to budi.ai. 10 USDT of the round goes to members budi.ai was short with earlier.');
  assert.equal(afterPayment({ ...R, labels, due, paid: 2, forRound: 2 }), null); // paying ahead: round 2 still waits for one more
  assert.equal(afterPayment({ ...R, labels, due, now: START + DAY, forRound: 2, recipient: budi }), 'Round 2 is past its deadline, so this payment also closes it and sends 10 USDT to budi.ai.');
  assert.equal(afterPayment({ ...R, labels, due, drawMode: true, paid: 2, forRound: 1 }), 'This payment completes round 2, so it also starts the draw. Anyone can finish it a few seconds later with close.');
  assert.equal(afterPayment({ ...R, labels, due, drawMode: true, paid: 3, drawBlock: 99n, forRound: 2 }), 'This payment also draws round 2’s recipient and sends them the money.');
  assert.equal(afterPayment({ ...R, labels, due, drawMode: true, paid: 3, drawBlock: 100n, forRound: 2 }), null); // draw block not mined
  assert.equal(afterPayment({ ...R, labels, due, closedRounds: 0, paid: 2, now: START - DAY, forRound: 0, recipient: { next: 1, skipped: 0 } }), 'This payment completes round 1, so it also sends 30 USDT to ayu.ai.'); // the last join
});

test('inbox: a due round nobody has closed is an open action for members with nothing to pay', () => {
  const running = circ({ joinedCount: 3, closedRounds: 1, now: START + DAY + 60 });
  const open = { round: 1, state: 'due' };
  assert.deepEqual(inboxEntry(running, 1, true, pl({ nextRound: 2, toPay: 1 }), open), { action: 'open', round: 2, yourTurn: { round: 2, at: START + DAY } });
  assert.equal(inboxEntry(running, 2, true, pl({ nextRound: 1, toPay: 2 }), open).action, 'pay'); // their payment closes it anyway
  assert.equal(inboxEntry(running, 0, true, pl({ nextRound: 3, payNow: false, toPay: 0 }), open).action, 'open');
  assert.equal(inboxEntry(running, 0, true, pl({ nextRound: 3, payNow: false, toPay: 0 }), { round: 1, state: 'draw_pending' }).action, 'done');
  const filled = circ({ joinedCount: 3, drawMode: true, now: START - 60 }); // draw scheduled by the last join
  assert.equal(inboxEntry(filled, 1, true, null, { round: 0, state: 'draw_ready' }).action, 'open');
});

// audit fixes
import { payoutPreview, explainRevert } from './giliran.mjs';

test('payout preview: the pot, minus the guarantee prepaying the recipient\'s next dues, minus dues they skipped', () => {
  assert.deepEqual(payoutPreview({ pot: 40, due: 10, size: 4, round: 1, guaranteeDues: 0, next: 1, skipped: 0 }), { sent: 40, prepaid: 0, recovered: 0 });
  assert.deepEqual(payoutPreview({ pot: 40, due: 10, size: 4, round: 1, guaranteeDues: 2, next: 1, skipped: 0 }), { sent: 20, prepaid: 20, recovered: 0 });
  assert.deepEqual(payoutPreview({ pot: 40, due: 10, size: 4, round: 2, guaranteeDues: 3, next: 3, skipped: 0 }), { sent: 30, prepaid: 10, recovered: 0 }); // one round left
  assert.deepEqual(payoutPreview({ pot: 40, due: 10, size: 4, round: 1, guaranteeDues: 3, next: 4, skipped: 0 }), { sent: 40, prepaid: 0, recovered: 0 }); // paid ahead already
  assert.deepEqual(payoutPreview({ pot: 30, due: 10, size: 4, round: 3, guaranteeDues: 0, next: 3, skipped: 2 }), { sent: 10, prepaid: 0, recovered: 20 });
});

test('inbox: everyone joined before the start: round 1 is done, nothing to pay until round 2 opens', () => {
  assert.deepEqual(inboxEntry(circ({ joinedCount: 3 }), 1, true, null), { action: 'full', opensAt: START, yourTurn: { round: 2, at: START + DAY } });
  assert.equal(inboxEntry(circ({ joinedCount: 2 }), 1, true, null).action, 'wait'); // still waiting for the others
});

test('reverts are explained in plain words, naming what to fix', () => {
  assert.match(explainRevert('0x42f058b4'), /does not hold/);
  assert.match(explainRevert('0xe1fdc1a8'), /not a claimed/);
  assert.match(explainRevert('0xa2f59dfe'), /few seconds/);
  const errorString = '0x08c379a0' + '0'.repeat(62) + '20' + '0'.repeat(62) + '05' + Buffer.from('hello').toString('hex').padEnd(64, '0');
  assert.equal(explainRevert(errorString), 'hello');
  assert.equal(explainRevert('0xdeadbeef'), null);
});

test('calendar: a joined member is reminded at the join deadline that an unfilled circle needs cancelling', () => {
  const [first] = events(calendarIcs(cal({ paid: [true], joinedCount: 2 })));
  assert.match(field(first, 'SUMMARY'), /^Giliran #1: join deadline$/);
  assert.match(field(first, 'DESCRIPTION'), /Cancel Giliran circle #1/);
  assert.ok(first.includes('TRIGGER:PT0M'));
});

test('calendar: every deadline says how to open a round that did not pay out; my own payout gets a check after it', () => {
  const ev = events(calendarIcs(cal({ me: 'budi', paid: [true], joinedCount: 3 })));
  assert.match(field(ev[1], 'DESCRIPTION'), /Open the kocokan of Giliran circle #1/);
  assert.ok(ev[1].includes('TRIGGER:PT30M')); // budi's own round: a nudge half an hour after its deadline
  assert.ok(!ev[2].includes('TRIGGER:PT30M'));
});

test('calendar: a full drawn circle shows round 1 as paying out, not a join reminder; drawn circles promise a draw', () => {
  const ev = events(calendarIcs(cal({ drawMode: true, joinedCount: 3 })));
  assert.match(field(ev[0], 'SUMMARY'), /round 1 pays out/);
  assert.match(field(ev[1], 'DESCRIPTION'), /the draw starts with the last payment/);
});

test('calendar: a re-import replaces the events (SEQUENCE grows with time)', () => {
  const [e] = events(calendarIcs(cal()));
  assert.equal(field(e, 'SEQUENCE'), String(Math.floor((START - 5 * 3600) / 60)));
});

// ---- dues below 1 USDT: cents, and amounts without float noise ----
test('dues from 0.01 USDT, in cents', () => {
  const at = (due) => parseTerms(args({ due, start: String(NOW + 7200) }), NOW).contribution;
  assert.equal(at('0.01'), 10n ** 16n);
  assert.equal(at('2.5'), 25n * 10n ** 17n);
  assert.equal(at('0,5'), 5n * 10n ** 17n); // an Indonesian decimal comma
  assert.equal(at('100'), 100n * 10n ** 18n);
});

test('payout amounts in cents add up exactly', () => {
  assert.deepEqual(payoutPreview({ pot: 0.21, due: 0.07, size: 3, round: 0, guaranteeDues: 1, next: 1, skipped: 0 }), { sent: 0.14, prepaid: 0.07, recovered: 0 });
  assert.equal(afterPayment({ ...R, labels: ['ayu', 'budi', 'citra'], due: 0.07, paid: 2, forRound: 1, recipient: { next: 1, skipped: 0 } }),
    'This payment completes round 2, so it also sends 0.21 USDT to budi.ai.');
});
