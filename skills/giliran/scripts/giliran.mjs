#!/usr/bin/env node
// Giliran helper for agents. It builds the exact contract call (`to`, `data`) for `baw contract-call preview`
// and reads a circle's state from BNB Chain. No dependencies. It never signs or sends anything: the user's
// Agentic Wallet does that, after the user's yes.
//
//   node giliran.mjs create  --organizer <name> --members <a,b,c> --due <usdt> --every daily|weekly|monthly
//                            --order draw|fixed [--guarantee none|1|...|full] [--start <unix seconds>] [--from <my address>]
//   node giliran.mjs created --tx <hash>                         which circle a create transaction made
//   node giliran.mjs status  --circle <n>                       terms, who joined, the open round
//   node giliran.mjs approve --circle <n> --name <me> --from <my address>   exact USDT approval for my dues
//   node giliran.mjs pay     --circle <n> --name <me> --from <my address>   one due (joining, before the start)
//   node giliran.mjs close   --circle <n> [--from <my address>]                     close a due round nobody has paid into since (payments close rounds too)
//   node giliran.mjs cancel  --circle <n>                       repay joiners of a circle that did not fill
//   node giliran.mjs record  --name <me>                         my payment record
//   node giliran.mjs inbox   --name <me>                         every open circle with my name: what to do, by when
//   node giliran.mjs calendar --circle <n> [--name <me>] [--lang en|id] [--out <file>]   the deadlines as an .ics file
//   node giliran.mjs stats
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const GILIRAN = process.env.GILIRAN_ADDRESS || '0x5D1050e1Be414c8798355fF727900a7d8bD0615b'; // deployed 2026-11-25, block 135617358
export const USDT = '0x55d398326f99059fF775485246999027B3197955';
const RPCS = (process.env.GILIRAN_RPC || 'https://bsc-dataseed.bnbchain.org,https://bsc-rpc.publicnode.com,https://bsc-dataseed1.defibit.io,https://bsc-dataseed1.ninicoin.io,https://bsc-mainnet.public.blastapi.io,https://bsc.meowrpc.com').split(',');
const SITE = 'https://giliran-app.vercel.app';
const CIRCLE_CREATED = '0x5b3cfca70bb6f42261e07de1a8ef61ab01402581ae457609af845c4a0b97866f';
const SEL = {
  createCircle: '0xeb6e9fdd', pay: '0x154fbbc4', close: '0x596c8976', cancel: '0x40e58ee5', approve: '0x095ea7b3',
  allowance: '0xdd62ed3e', balanceOf: '0x70a08231', circleCount: '0xcf0b1117', circleInfo: '0x65f75746', labels: '0xf25fed48',
  joined: '0xd5ae1e0a', paid: '0x628a55ca', paidCount: '0xc4f1cc06', deadlineOf: '0x3d418757', drawBlockOf: '0x8428574e',
  recipientOf: '0x8a948428', recordOfName: '0x4f8456ee', stats: '0xd80528ae',
  received: '0x49c1033d', covered: '0x715a708f', recovered: '0xd2b3f98f', payoutOf: '0xa19b6ff6',
  organizerOf: '0x1e6e146b', claimed: '0xb8945670',
};
// the contract's custom errors, said as the user would need to hear them
const ERRORS = {
  '0x6c41d8c6': 'there is no such circle.',
  '0x42f058b4': 'this wallet does not hold that .ai name. Only the wallet holding a name can create with it or pay for its seat.',
  '0x291fc442': 'that name is not a member of this circle.',
  '0x6cd3dc25': 'a circle has 3 to 25 members.',
  '0xece0e402': 'a name appears twice in the member list.',
  '0xe1fdc1a8': 'a member name is not a claimed Agent ID. Check the spelling of every name.',
  '0x8dc59921': 'the terms are out of range (dues 0.01 to 100 USDT, a round between an hour and 90 days, the guarantee below the member count, a start between now and 30 days out).',
  '0x003b2682': 'this name has already joined. Nothing to pay until the start, when round 2 dues open.',
  '0xf36efb6f': 'everyone joined, so this circle cannot be cancelled.',
  '0x80cb55e2': 'this circle is not running (it was cancelled, or not everyone joined in time).',
  '0x6f312cbd': 'the join deadline has not passed yet.',
  '0x47a2375f': 'this round is not due yet: not everyone has paid and its deadline has not passed.',
  '0xc3fa7054': 'someone else closed this round a moment ago. Check status again.',
  '0xa2f59dfe': 'the draw block is not mined yet. Try again in a few seconds.',
  '0x51ba7413': 'every round of this name is already paid.',
  '0x5274afe7': 'the USDT transfer failed: check the approval and the USDT balance.',
};
/** A revert's data in plain words, or null when it is not one of ours (the caller shows the node's message). */
export function explainRevert(data) {
  const d = String(data ?? '').toLowerCase();
  if (ERRORS[d.slice(0, 10)]) return ERRORS[d.slice(0, 10)];
  if (d.startsWith('0x08c379a0') && d.length >= 138) { // Error(string)
    const len = Number.parseInt(d.slice(74, 138), 16);
    return Buffer.from(d.slice(138, 138 + 2 * len), 'hex').toString('utf8');
  }
  return null;
}
const USD = 10n ** 18n; // BSC USDT has 18 decimals
const PERIODS = { daily: 86_400, weekly: 7 * 86_400, monthly: 30 * 86_400 };
const LABEL = /^[a-z0-9-]{1,63}$/;

// ABI encoding (uint, bool, address, string, string[])
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const hexOf = (s) => Buffer.from(s, 'utf8').toString('hex');
const encString = (s) => { const h = hexOf(s); return word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0'); };
function encStrings(list) {
  let offsets = '';
  let body = '';
  for (const s of list) { offsets += word(list.length * 32 + body.length / 2); body += encString(s); }
  return word(list.length) + offsets + body;
}
function encode(sel, items) {
  let head = '';
  let tail = '';
  for (const [type, v] of items) {
    if (type === 'string' || type === 'string[]') { head += word(items.length * 32 + tail.length / 2); tail += type === 'string' ? encString(v) : encStrings(v); }
    else if (type === 'bool') head += word(v ? 1 : 0);
    else if (type === 'address') head += v.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    else head += word(v);
  }
  return sel + head + tail;
}

export const encodeCreate = (t) => encode(SEL.createCircle, [['string', t.organizer], ['string[]', t.members], ['uint', t.contribution], ['uint', t.period], ['uint', t.startAt], ['bool', t.drawMode], ['uint', t.guaranteeDues]]);
export const encodePay = (id, name) => encode(SEL.pay, [['uint', id], ['string', name]]);
export const encodeClose = (id, r) => encode(SEL.close, [['uint', id], ['uint', r]]);
export const encodeCancel = (id) => encode(SEL.cancel, [['uint', id]]);
export const encodeApprove = (spender, amount) => encode(SEL.approve, [['address', spender], ['uint', amount]]);

// ABI decoding
const words = (hex) => (hex.replace(/^0x/, '').match(/.{64}/g) ?? []);
const u = (w) => BigInt('0x' + w);
export function decodeStrings(hex) {
  const h = hex.replace(/^0x/, '');
  const at = (byte) => Number(BigInt('0x' + h.slice(byte * 2, byte * 2 + 64)));
  const base = at(0);
  const n = at(base);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = base + 32 + at(base + 32 + i * 32);
    out.push(Buffer.from(h.slice((o + 32) * 2, (o + 32 + at(o)) * 2), 'hex').toString('utf8'));
  }
  return out;
}

// terms, with the contract's checks and the field named
export class TermsError extends Error {
  constructor(field, message) { super(message); this.field = field; }
}
const name = (s) => String(s ?? '').trim().toLowerCase().replace(/\.ai$/, '');

/** '2.5' USDT as wei: whole USDT and cents, no float on the way. */
const dueWei = (due) => { const [w, c = ''] = due.split('.'); return (BigInt(w) * 100n + BigInt(c.padEnd(2, '0'))) * (USD / 100n); };

export function parseTerms(a, now) {
  const members = String(a.members ?? '').split(',').map(name).filter(Boolean);
  if (members.length < 3 || members.length > 25) throw new TermsError('members', 'A circle needs 3 to 25 members.');
  const bad = members.filter((m) => !LABEL.test(m));
  if (bad.length) throw new TermsError('members', `Not a .ai name: ${bad.join(', ')}.`);
  if (new Set(members).size !== members.length) throw new TermsError('members', 'A name appears twice.');
  const organizer = name(a.organizer);
  if (!members.includes(organizer)) throw new TermsError('organizer', 'The organizer must be one of the members.');
  const due = String(a.due ?? '').replace(',', '.'); // 0,5 (Indonesian) or 0.5
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(due) || Number(due) < 0.01 || Number(due) > 100) throw new TermsError('due', 'Dues are 0.01 to 100 USDT, in cents at most (for example 0.5 or 10).');
  if (!(a.every in PERIODS)) throw new TermsError('every', 'Schedule is daily, weekly or monthly.');
  if (a.order !== 'draw' && a.order !== 'fixed') throw new TermsError('order', 'Order is draw or fixed.');
  // like a real arisan, whoever's turn it is gets the whole pot; a hold-back is only set when the organizer asks
  const g = String(a.guarantee ?? 'none');
  const guaranteeDues = g === 'none' ? 0 : g === 'full' ? members.length - 1 : /^\d+$/.test(g) ? Number(g) : NaN;
  if (!(guaranteeDues >= 0 && guaranteeDues < members.length)) throw new TermsError('guarantee', `A hold-back is none, 1 to ${members.length - 1} dues, or full.`);
  const start = a.start ? Number(a.start) : Math.ceil((now + 2 * 86_400) / 3_600) * 3_600;
  if (!Number.isInteger(start) || start < now + 3_600 || start > now + 30 * 86_400) throw new TermsError('start', 'The first round must be between one hour and 30 days from now, so members can join first.');
  return { organizer, members, contribution: dueWei(due), period: BigInt(PERIODS[a.every]), startAt: BigInt(start), drawMode: a.order === 'draw', guaranteeDues };
}

// what a member owes, as the contract counts it
// A payment goes to the oldest round still open that the member has not paid. The guarantee pays a recipient's
// next dues at their payout (on chain as `covered`). Dues skipped in closed rounds before their turn come out of
// their payout.
export function duesPlan({ size, closedRounds, paid, covered, recovered }) {
  const done = (r) => paid[r] || covered[r];
  let nextRound = closedRounds;
  while (nextRound < size && done(nextRound)) nextRound++;
  let toPay = 0;
  for (let r = nextRound; r < size; r++) if (!done(r)) toPay++;
  let skipped = 0;
  for (let r = 0; r < closedRounds; r++) if (!done(r) && !recovered[r]) skipped++;
  // the open round paid from their payout: nothing to pay this round
  return { nextRound, payNow: nextRound < size && !covered[closedRounds], toPay, skipped };
}

/** What the recipient of round `round` gets from a pot of `pot` USDT, as the contract settles it: the guarantee first
 *  pays up to `guaranteeDues` of their next unpaid dues (from round max(next, round + 1)), then each due they skipped
 *  before their turn goes to whoever was short. */
export function payoutPreview({ pot, due, size, round, guaranteeDues, next, skipped }) {
  // in whole cents, so 3 x 0.07 is 0.21 and not 0.21000000000000002
  const [potC, dueC] = [Math.round(pot * 100), Math.round(due * 100)];
  const ahead = Math.max(0, size - Math.max(next, round + 1));
  const prepaid = Math.min(guaranteeDues, ahead, Math.floor(potC / dueC)) * dueC;
  const recovered = Math.min(skipped, Math.floor((potC - prepaid) / dueC)) * dueC;
  return { sent: (potC - prepaid - recovered) / 100, prepaid: prepaid / 100, recovered: recovered / 100 };
}

// A circle's round deadlines as an iCalendar file with reminders, for the user's own calendar app.
// site/calendar.js holds the same function (the site and the skill ship separately); a test keeps them identical.
export function calendarIcs({ circle: n, contract, labels, period, startAt, drawMode, due, link, now, lang = 'en', me = null, paid = [], closedRounds = 0, joinedCount = labels.length }) {
  const T = lang === 'id' ? {
    join: `Giliran #${n}: terakhir untuk ikut (${due})`,
    deadline: `Giliran #${n}: batas waktu ikut`,
    deadlineDo: `Kalau sampai waktu ini belum semua ikut, arisannya tidak bisa jalan. Bilang ke agenmu: "Batalkan arisan Giliran #${n}", dan semua yang sudah ikut dapat ${due} mereka kembali.`,
    openDo: `Kalau uang putaran ini belum keluar setelah waktu ini, bilang ke agenmu: "Buka kocokan arisan Giliran #${n}."`,
    myCheck: `Giliranmu: kalau uangnya belum masuk, bilang ke agenmu: "Buka kocokan arisan Giliran #${n}."`,
    close: (r) => `Giliran #${n}: iuran putaran ${r} ditutup (${due})`,
    paysOut: (r) => `Giliran #${n}: putaran ${r} dibayarkan`,
    mine: ', giliranmu',
    joinDo: `Ikut dengan membayar iuran pertama ${due} sebelum waktu ini. Bilang ke agenmu: "Ikut arisan Giliran #${n}."`,
    payDo: `Bayar ${due} sebelum waktu ini. Bilang ke agenmu: "Bayar iuran arisan Giliran #${n}." Kalau semua bayar lebih awal, ${drawMode ? 'pengundiannya dimulai saat bayaran terakhir masuk' : 'uang putaran ini langsung dikirim saat bayaran terakhir masuk'}.`,
    to: (who) => `Uang putaran ini untuk ${who}.ai.`,
    toMe: 'Giliranmu: uang putaran ini untukmu.',
    drawn: 'Penerimanya diundi setelah putarannya ditutup.',
  } : {
    join: `Giliran #${n}: last moment to join (${due})`,
    deadline: `Giliran #${n}: join deadline`,
    deadlineDo: `If not everyone has joined by this time, the circle cannot run. Tell your agent: "Cancel Giliran circle #${n}", and everyone who joined gets their ${due} back.`,
    openDo: `If this round's money has not gone out after this time, tell your agent: "Open the kocokan of Giliran circle #${n}."`,
    myCheck: `Your payout: if it has not arrived, tell your agent: "Open the kocokan of Giliran circle #${n}."`,
    close: (r) => `Giliran #${n}: round ${r} dues close (${due})`,
    paysOut: (r) => `Giliran #${n}: round ${r} pays out`,
    mine: ', your turn',
    joinDo: `Join by paying the first ${due} before this time. Tell your agent: "Join Giliran circle #${n}."`,
    payDo: `Pay ${due} before this time. Tell your agent: "Pay my dues for Giliran circle #${n}." If everyone pays early, ${drawMode ? 'the draw starts with the last payment' : 'the round’s money goes out with the last payment'}.`,
    to: (who) => `This round's pot goes to ${who}.ai.`,
    toMe: "Your turn: this round's pot comes to you.",
    drawn: 'The recipient is drawn after the round closes.',
  };
  const esc = (s) => s.replace(/[\\,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const utc = (s) => new Date(s * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // seconds before the event (negative: after it) as an RFC 5545 duration
  const dur = (s) => { const a = Math.abs(s), d = s > 0 ? '-' : ''; return a === 0 ? 'PT0M' : a % 86_400 === 0 ? `${d}P${a / 86_400}D` : a % 3600 === 0 ? `${d}PT${a / 3600}H` : `${d}PT${Math.round(a / 60)}M`; };
  // RFC 5545: lines longer than 75 octets continue on the next line after a space
  const octets = (ch) => { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };
  const fold = (line) => { let out = '', used = 0; for (const ch of line) { if (used + octets(ch) > 75) { out += '\r\n '; used = 1; } out += ch; used += octets(ch); } return out; };
  if (now >= startAt && joinedCount < labels.length) return null; // never filled: no round will run, it can only be cancelled
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Giliran//Giliran//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:Giliran #${n}`];
  let count = 0;
  for (let r = closedRounds; r < labels.length; r++) {
    // the contract's deadline for round r: it closes earlier once everyone has paid it, or at the first payment
    // (or close) after this time
    const at = startAt + r * period;
    if (at <= now) continue;
    const full = joinedCount >= labels.length;
    const join = r === 0 && !paid[0] && !full;
    const waiting = r === 0 && paid[0] && !full; // joined, the others not yet
    const done = Boolean(paid[r]) || (r === 0 && full);
    const mine = !drawMode && me === labels[r];
    const summary = waiting ? T.deadline : (join ? T.join : done ? T.paysOut(r + 1) : T.close(r + 1)) + (mine ? T.mine : '');
    const desc = waiting ? [T.deadlineDo, link].join('\n\n')
      : [join ? T.joinDo : done ? null : T.payDo, drawMode ? T.drawn : mine ? T.toMe : T.to(labels[r]), join ? null : T.openDo, link].filter(Boolean).join('\n\n');
    // when the round opens (if that is more than a day ahead), a day before, and a last call; my own payout gets a
    // check half an hour after its deadline; a joiner is told at the deadline if the circle did not fill
    const alarms = waiting ? [[0, T.deadline]] : [
      ...(done ? [] : [...(r > 0 && period > 86_400 ? [period] : []), Math.min(period, 86_400), period > 3600 ? 3600 : 600].map((x) => [x, summary])),
      ...(mine ? [[-1800, T.myCheck]] : []),
    ];
    lines.push('BEGIN:VEVENT', `UID:giliran-${contract.toLowerCase()}-${n}-${r}@giliran-app.vercel.app`, `SEQUENCE:${Math.floor(now / 60)}`, `DTSTAMP:${utc(now)}`, `DTSTART:${utc(at)}`, `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(desc)}`, `URL:${link}`);
    for (const [x, text] of alarms) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${dur(x)}`, `DESCRIPTION:${esc(text)}`, 'END:VALARM');
    lines.push('END:VEVENT');
    count++;
  }
  if (!count) return null;
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Approve exactly what the user still owes across all their circles; an allowance already equal to it needs nothing. */
export function approvalPlan(current, owed) {
  const target = owed.reduce((sum, o) => sum + o.amount, 0n);
  return { target, ready: current !== target };
}

/** Rounds member i has nothing to pay for: paid by them, or paid from their payout (covered). */
export function settledRounds({ paid, covered }) {
  return paid.map((p, r) => Boolean(p || covered[r]));
}

/** State of the oldest open round r (= closedRounds) of a full circle, by the contract's rules: it can close once
 *  everyone has paid it or its deadline has passed (round 0: once everyone has joined). A drawn round, other than
 *  the last, closes in two steps: the first schedules the draw block, a call after that block draws and pays. */
export function roundState({ size, closedRounds: r, startAt, period, now, drawMode, paid, drawBlock = 0n, block = 0n }) {
  if (Number(paid) < size && Number(now) < Number(startAt) + r * Number(period)) return 'collecting';
  if (!drawMode || r + 1 >= size || BigInt(drawBlock) === 0n) return 'due';
  return BigInt(block) > BigInt(drawBlock) ? 'draw_ready' : 'draw_pending';
}

/** What a payment credited to round `forRound` also does: `pay` closes the oldest open round when that
 *  payment makes it due. Said before the user's yes, since it moves the round's money too. `due` in USDT. */
export function afterPayment({ labels, due, forRound, guaranteeDues = 0, recipient = { next: 0, skipped: 0 }, ...k }) {
  const r = k.closedRounds, n = labels.length;
  const paid = Number(k.paid) + (forRound === r ? 1 : 0);
  const state = roundState({ ...k, size: n, paid });
  if (state === 'collecting' || state === 'draw_pending') return null;
  if (state === 'draw_ready') return `This payment also draws round ${r + 1}’s recipient and sends them the money.`;
  const completes = paid === n;
  if (k.drawMode && r + 1 < n) return `${completes ? `This payment completes round ${r + 1}` : `Round ${r + 1} is past its deadline`}, so it also starts the draw. Anyone can finish it a few seconds later with close.`;
  if (k.drawMode) return `${completes ? `This payment completes round ${r + 1}` : `Round ${r + 1} is past its deadline`}, so it also sends the round’s money to the one member who has not received yet.`;
  const to = `${labels[r]}.ai`;
  const { sent, prepaid, recovered } = payoutPreview({ pot: (paid * Math.round(due * 100)) / 100, due, size: n, round: r, guaranteeDues, ...recipient });
  return (completes ? `This payment completes round ${r + 1}, so it also sends ${sent} USDT to ${to}.` : `Round ${r + 1} is past its deadline, so this payment also closes it and sends ${sent} USDT to ${to}.`)
    + (prepaid ? ` ${prepaid} USDT of the round pays ${to}’s next due${prepaid > due ? 's' : ''} now (the guarantee).` : '')
    + (recovered ? ` ${recovered} USDT of the round goes to members ${to} was short with earlier.` : '');
}

/** What member i has to do in circle c next (times in unix seconds), or null when nothing of theirs is open.
 *  `open` is the oldest open round ({ round, state }): when it is due and nobody has closed it, a member with
 *  nothing to pay is asked to open it (a member who owes just pays: that payment closes it). */
export function inboxEntry(c, i, joined, p, open = null) {
  const e = todo(c, i, joined, p);
  if (!e || e.action === 'pay' || !['due', 'draw_ready'].includes(open?.state)) return e;
  return { action: 'open', round: open.round + 1, ...(e.yourTurn ? { yourTurn: e.yourTurn } : {}) };
}

function todo(c, i, joined, p) {
  if (c.cancelled || c.closedRounds >= c.size) return null;
  const deadline = (r) => c.startAt + r * c.period;
  const turn = !c.drawMode && i >= c.closedRounds ? { yourTurn: { round: i + 1, at: deadline(i) } } : {}; // fixed order: member i receives round i
  if (c.now < c.startAt) {
    if (!joined) return { action: 'join', round: 1, by: c.startAt, ...turn };
    // everyone in: round 1 has paid out (or is being drawn); round 2 dues open at the start
    return c.joinedCount >= c.size ? { action: 'full', opensAt: c.startAt, ...turn } : { action: 'wait', by: c.startAt, ...turn };
  }
  if (c.joinedCount < c.size) return joined ? { action: 'cancel' } : null;
  if (!p.payNow) return p.toPay === 0 ? { action: 'done' } : { action: 'covered', ...turn };
  if (p.nextRound > c.closedRounds) return { action: 'paid', round: p.nextRound + 1, by: deadline(p.nextRound), ...turn };
  return { action: 'pay', round: p.nextRound + 1, by: deadline(p.nextRound), late: c.now >= deadline(p.nextRound), ...turn };
}

// chain reads
/** POST to the first endpoint whose answer passes `valid`; on a full miss, wait (250 ms, then 1 s) and go round again. */
async function post(urls, body, valid) {
  for (let t = 0; t < 3; t++) {
    for (const url of urls) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
        if (!r.ok) continue; // 429 or 5xx: try the next endpoint
        const j = await r.json();
        if (valid(j)) return j;
      } catch { /* next endpoint */ }
    }
    if (t < 2) await new Promise((res) => setTimeout(res, 250 * 4 ** t));
  }
  return null;
}
const reverted = (x) => /revert/.test(x?.error?.message ?? '');
async function rpcAt(urls, method, params) {
  const j = await post(urls, { jsonrpc: '2.0', id: 1, method, params }, (x) => x.result !== undefined || reverted(x));
  if (!j) throw new Error('BNB Chain did not answer. Try again shortly.');
  if (reverted(j)) throw Object.assign(new Error(j.error.message), { revert: true });
  return j.result;
}
const rpc = (method, params) => rpcAt(RPCS, method, params);

/** Run the call as `from` would send it; a revert becomes a plain-words error before the wallet previews anything. */
async function preflight(from, t) {
  const j = await post(RPCS, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ from, to: t.to, data: t.data }, 'latest'] }, (x) => x && (x.result !== undefined || x.error));
  if (!j) throw new Error('BNB Chain did not answer. Try again shortly.');
  if (j.error) throw new TermsError('refused', `The contract would refuse this: ${explainRevert(j.error.data) ?? j.error.message}`);
  return t;
}
/** BNB for the network fee: a warning only, since some wallets pay fees for their users. */
async function feeNote(from) {
  const wei = BigInt(await rpc('eth_getBalance', [from, 'latest']));
  return wei < 5n * 10n ** 13n ? { feeNote: 'This wallet has almost no BNB. If the wallet does not cover network fees, add a little BNB (0.001 is plenty).' } : {};
}
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const fromOf = (a) => {
  if (!ADDRESS.test(String(a.from ?? ''))) throw new TermsError('from', 'Give your Agentic Wallet address, for example --from 0x1234…');
  return a.from;
};

/** Many eth_calls as JSON-RPC batches of 20, results in the order asked; one call at a time where batches are refused. */
export async function ethCalls(urls, list) {
  const out = [];
  for (let k = 0; k < list.length; k += 20) {
    const chunk = list.slice(k, k + 20);
    const body = chunk.map(([to, data], id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] }));
    const res = await post(urls, body, (j) => Array.isArray(j) && j.length === chunk.length && j.every((x) => x.result !== undefined || reverted(x)));
    if (!res) { out.push(...(await Promise.all(chunk.map(([to, data]) => rpcAt(urls, 'eth_call', [{ to, data }, 'latest']))))); continue; }
    const byId = new Map(res.map((x) => [x.id, x]));
    for (let id = 0; id < chunk.length; id++) {
      const x = byId.get(id);
      if (reverted(x)) throw Object.assign(new Error(x.error.message), { revert: true });
      out.push(x.result);
    }
  }
  return out;
}
const reads = (list) => ethCalls(RPCS, list);
const flags = async (list) => (await reads(list)).map((h) => u(words(h)[0]));
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const callU = async (to, data) => u(words(await call(to, data))[0]);

// People see circle numbers from 1 (giliran-app.vercel.app/?c=1, "circle #1"); the contract counts from 0.
const idOf = (a) => {
  if (!/^\d{1,9}$/.test(String(a.circle))) throw new TermsError('circle', 'Give the circle number, for example --circle 1.');
  const n = BigInt(a.circle);
  if (n < 1n) throw new TermsError('circle', 'Circle numbers start at 1.');
  return n - 1n;
};
const num = (id) => Number(id) + 1;

async function circle(id) {
  let info;
  try { info = words(await call(GILIRAN, encode(SEL.circleInfo, [['uint', id]]))); } catch { throw new TermsError('circle', `There is no Giliran circle #${num(id)}.`); }
  const [contribution, period, startAt, drawMode, guaranteeDues, size, joinedCount, closedRounds, cancelled] = info.map(u);
  const labels = decodeStrings(await call(GILIRAN, encode(SEL.labels, [['uint', id]])));
  const now = BigInt(Number.parseInt((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp, 16));
  return { id, contribution, period, startAt, drawMode: drawMode === 1n, guaranteeDues: Number(guaranteeDues), size: Number(size), joinedCount: Number(joinedCount), closedRounds: Number(closedRounds), cancelled: cancelled === 1n, labels, now };
}
const usdt = (wei) => `${Number(wei / 10n ** 15n) / 1000} USDT`;
const when = (s) => new Date(Number(s) * 1000).toISOString();
const tx = (to, data, summary) => ({ to, value: '0', data, summary });

async function openRound(c) {
  const r = c.closedRounds;
  if (c.cancelled || r >= c.size) return null;
  if (c.joinedCount < c.size) return c.now >= c.startAt ? { round: 0, state: 'not_filled' } : { round: 0, state: 'joining', joinBy: when(c.startAt) };
  const [paid, deadline, drawBlock] = await Promise.all([
    callU(GILIRAN, encode(SEL.paidCount, [['uint', c.id], ['uint', r]])),
    callU(GILIRAN, encode(SEL.deadlineOf, [['uint', c.id], ['uint', r]])),
    callU(GILIRAN, encode(SEL.drawBlockOf, [['uint', c.id], ['uint', r]])),
  ]);
  const block = drawBlock > 0n ? BigInt(await rpc('eth_blockNumber', [])) : 0n;
  const state = roundState({ size: c.size, closedRounds: r, startAt: c.startAt, period: c.period, now: c.now, drawMode: c.drawMode, paid, drawBlock, block });
  return { round: r, state, paid: Number(paid), of: c.size, deadline: when(deadline), ...(drawBlock > 0n ? { drawBlock: Number(drawBlock), block: Number(block) } : {}) };
}

async function plan(c, i) {
  const rounds = [...Array(c.size).keys()];
  const per = (sel) => rounds.map((r) => [GILIRAN, encode(sel, [['uint', c.id], ['uint', r], ['uint', i]])]);
  const v = await flags([...per(SEL.paid), ...per(SEL.covered), ...per(SEL.recovered), [GILIRAN, encode(SEL.received, [['uint', c.id], ['uint', i]])]]);
  const n = c.size;
  const [paid, covered, recovered] = [0, 1, 2].map((k) => v.slice(k * n, k * n + n).map((x) => x === 1n));
  const received = v[3 * n] === 1n;
  return { ...duesPlan({ size: n, closedRounds: c.closedRounds, paid, covered, recovered }), received, paid, covered };
}

/** Every circle with this name in it, newest first. Reads each circle's member list in batches; past a few thousand
 *  circles, finding them from CircleCreated logs would be faster. */
async function circlesWith(me) {
  const count = Number(await callU(GILIRAN, SEL.circleCount));
  const ids = [...Array(count).keys()].reverse().map(BigInt);
  const lists = (await reads(ids.map((id) => [GILIRAN, encode(SEL.labels, [['uint', id]])]))).map(decodeStrings);
  return ids.filter((_, k) => lists[k].includes(me));
}
/** A single ABI string return, read as a one-item string[] (its first word is the item's offset). */
const decodeString = (hex) => decodeStrings('0x' + word(32) + word(1) + hex.slice(2))[0];
const organizerOf = async (c) => decodeString(await call(GILIRAN, encode(SEL.organizerOf, [['uint', c.id]])));
const running = (c) => !c.cancelled && c.now >= c.startAt && c.joinedCount === c.size && c.closedRounds < c.size;
/** Dues member i still pays from their wallet in circle c: none once it is over, cancelled or failed to fill. */
async function owedIn(c, i) {
  if (c.cancelled || c.closedRounds >= c.size || (c.now >= c.startAt && c.joinedCount < c.size)) return 0n;
  return BigInt((await plan(c, i)).toPay) * c.contribution;
}

// commands
const commands = {
  async create(a) {
    const t = parseTerms(a, Math.floor(Date.now() / 1000));
    const claimed = await flags(t.members.map((m) => [GILIRAN, encode(SEL.claimed, [['string', m]])]));
    const unclaimed = t.members.filter((_, k) => claimed[k] !== 1n);
    if (unclaimed.length) throw new TermsError('members', `Not a claimed Agent ID: ${unclaimed.map((m) => `${m}.ai`).join(', ')}. Check the spelling.`);
    if (a.from) await preflight(fromOf(a), { to: GILIRAN, data: encodeCreate(t) });
    return tx(GILIRAN, encodeCreate(t), {
      action: 'create circle (takes no money)', organizer: `${t.organizer}.ai`, members: t.members.map((m) => `${m}.ai`),
      dues: usdt(t.contribution), every: a.every, order: t.drawMode ? 'drawn' : 'in list order', guaranteeDues: t.guaranteeDues, joinBy: when(t.startAt),
      next: 'After it is mined: node giliran.mjs created --tx <hash>, then everyone, the organizer included, joins by paying the first due.',
    });
  },
  async created(a) {
    const r = await rpc('eth_getTransactionReceipt', [a.tx]);
    const log = r?.logs?.find((l) => l.address.toLowerCase() === GILIRAN.toLowerCase() && l.topics[0] === CIRCLE_CREATED);
    if (!log) throw new TermsError('tx', 'That transaction did not create a Giliran circle (or is not mined yet).');
    const id = u(log.topics[1].slice(2));
    return { circle: num(id), invite: `${SITE}/?c=${num(id)}` };
  },
  async status(a) {
    const c = await circle(idOf(a));
    const joined = await flags(c.labels.map((_, i) => [GILIRAN, encode(SEL.joined, [['uint', c.id], ['uint', i]])]));
    const closed = [...Array(c.closedRounds).keys()];
    const at = (sel, r) => [GILIRAN, encode(sel, [['uint', c.id], ['uint', r]])];
    const [recipients, payouts] = await Promise.all([SEL.recipientOf, SEL.payoutOf].map((sel) => flags(closed.map((r) => at(sel, r)))));
    const organizer = await organizerOf(c);
    const open = await openRound(c);
    // who still owes the open round (paid from their own payout counts as paid)
    let unpaid = [];
    if (open && running(c)) {
      const r = open.round, per = (sel) => c.labels.map((_, i) => [GILIRAN, encode(sel, [['uint', c.id], ['uint', r], ['uint', i]])]);
      const [p, cov] = await Promise.all([flags(per(SEL.paid)), flags(per(SEL.covered))]);
      unpaid = c.labels.filter((_, i) => p[i] !== 1n && cov[i] !== 1n).map((l) => `${l}.ai`);
    }
    return {
      circle: num(c.id), organizer: `${organizer}.ai`, members: c.labels.map((l) => `${l}.ai`), dues: usdt(c.contribution), periodDays: Number(c.period) / 86_400,
      order: c.drawMode ? 'drawn' : 'in list order', guaranteeDues: c.guaranteeDues, joinBy: when(c.startAt),
      joined: c.labels.filter((_, i) => joined[i] === 1n).map((l) => `${l}.ai`), cancelled: c.cancelled,
      received: closed.map((r) => ({ round: r + 1, name: `${c.labels[Number(recipients[r])]}.ai`, got: usdt(payouts[r]) })),
      round: open && { ...open, round: open.round + 1, ...(running(c) ? { unpaid } : {}) }, invite: `${SITE}/?c=${num(c.id)}`,
    };
  },
  async approve(a) {
    const c = await circle(idOf(a));
    const me = name(a.name);
    if (c.labels.indexOf(me) < 0) throw new TermsError('name', `${me}.ai is not in this circle.`);
    // One USDT allowance serves all the user's circles, so it is set to exactly what they still owe in all of them:
    // running this twice, or for a second circle, never leaves more than that.
    // Circles someone else put this name in but the user never joined count for nothing: only this circle and
    // the ones they joined.
    const from = fromOf(a);
    const owed = await Promise.all((await circlesWith(me)).map(async (id) => {
      const k = id === c.id ? c : await circle(id);
      const i = k.labels.indexOf(me);
      if (id !== c.id && (await callU(GILIRAN, encode(SEL.joined, [['uint', k.id], ['uint', i]]))) !== 1n) return { circle: num(id), amount: 0n };
      return { circle: num(id), amount: await owedIn(k, i) };
    }));
    const current = await callU(USDT, encode(SEL.allowance, [['address', from], ['address', GILIRAN]]));
    const { target, ready } = approvalPlan(current, owed);
    const here = owed.find((o) => o.circle === num(c.id))?.amount ?? 0n;
    if (!ready) return { ready: false, reason: target === 0n ? 'Nothing left to pay from your wallet in your circles.' : `Already approved exactly ${usdt(target)}: your remaining dues in your circles. Nothing to send.` };
    if (target === 0n) return tx(USDT, encodeApprove(GILIRAN, 0n), { action: 'remove the permission left over: you owe nothing more in your circles', totalAllowance: '0 USDT' });
    return tx(USDT, encodeApprove(GILIRAN, target), {
      ...(await feeNote(from)),
      action: `allow Giliran to collect your remaining dues${owed.length > 1 ? ' in your circles' : ` for circle #${num(c.id)}`}`,
      forThisCircle: usdt(here), totalAllowance: usdt(target), circles: owed.filter((o) => o.amount > 0n).map((o) => `#${o.circle}: ${usdt(o.amount)}`),
      note: 'Giliran can use it only when you yourself call pay, one due at a time.',
    });
  },
  async pay(a) {
    const c = await circle(idOf(a));
    const me = name(a.name);
    const i = c.labels.indexOf(me);
    if (i < 0) throw new TermsError('name', `${me}.ai is not in this circle.`);
    if (c.cancelled) throw new TermsError('circle', 'This circle was cancelled; joiners were repaid.');
    if (c.closedRounds >= c.size) throw new TermsError('circle', 'This circle has finished.');
    const joining = c.now < c.startAt;
    const isJoined = (await callU(GILIRAN, encode(SEL.joined, [['uint', c.id], ['uint', i]]))) === 1n;
    if (joining && isJoined) throw new TermsError('circle', `${me}.ai has joined. Round 2 dues open at the start (${when(c.startAt)}); round 1 pays out once everyone has joined.`);
    if (!joining && c.joinedCount < c.size) throw new TermsError('circle', 'Not everyone joined before the start; this circle can be cancelled and every joiner repaid (node giliran.mjs cancel).');
    const from = fromOf(a);
    const [allowance, balance] = await Promise.all([
      callU(USDT, encode(SEL.allowance, [['address', from], ['address', GILIRAN]])),
      callU(USDT, encode(SEL.balanceOf, [['address', from]])),
    ]);
    const p = joining ? null : await plan(c, i);
    if (p && !p.payNow) return { ready: false, reason: p.toPay === 0 ? 'Nothing left to pay: your payout already paid your remaining dues.' : 'Nothing to pay this round: your payout already paid it (the guarantee). Pay again from the round after.' };
    const approveCmd = `node giliran.mjs approve --circle ${num(c.id)} --name ${me} --from ${from}`;
    if (balance < c.contribution) throw new TermsError('balance', `Not enough USDT: ${usdt(balance)} in the wallet, ${usdt(c.contribution)} needed.${allowance < c.contribution ? ` After adding it, approve first: ${approveCmd}` : ''}`);
    if (allowance < c.contribution) throw new TermsError('allowance', `Approve first: ${approveCmd}`);
    const k = joining ? { paid: c.joinedCount } : await openRound(c);
    const forRound = joining ? 0 : p.nextRound;
    const base = {
      labels: c.labels, due: Number(c.contribution / 10n ** 15n) / 1000, forRound, closedRounds: c.closedRounds, guaranteeDues: c.guaranteeDues,
      startAt: c.startAt, period: c.period, now: c.now, drawMode: c.drawMode, paid: k.paid, drawBlock: k.drawBlock ?? 0, block: k.block ?? 0,
    };
    let also = afterPayment(base);
    if (also && !c.drawMode) { // name the real amounts: the fixed-order recipient's guarantee and skipped dues
      const r = c.closedRounds, rp = r === i && p ? p : await plan(c, r);
      also = afterPayment({ ...base, recipient: { next: rp.nextRound, skipped: rp.skipped } });
    }
    const late = !joining && forRound === c.closedRounds && c.now >= c.startAt + BigInt(forRound) * c.period;
    const t = tx(GILIRAN, encodePay(c.id, me), {
      action: joining ? 'join: pay the first due' : 'pay dues', circle: num(c.id), name: `${me}.ai`, amount: usdt(c.contribution),
      ...(joining ? { joinBy: when(c.startAt) } : { forRound: forRound + 1, leftAfterThis: p.toPay - 1 }),
      ...(late ? { lateNote: `Round ${forRound + 1} is past its deadline. This counts for it if it lands first; if someone else's payment or close lands before it, round ${forRound + 1} closes without it, is recorded as missed, and this counts for round ${forRound + 2}.` } : {}),
      ...(also ? { alsoDoes: also } : {}),
      ...(p?.skipped ? { skippedEarlier: `${p.skipped} missed due(s); ${p.received ? 'recorded as missed' : 'taken from your payout when your turn comes'}` } : {}),
      ...(await feeNote(from)),
    });
    return preflight(from, t);
  },
  async close(a) {
    const c = await circle(idOf(a));
    const k = await openRound(c);
    if (!k || !['due', 'draw_ready'].includes(k.state)) {
      if (k?.state === 'draw_pending') return { ready: false, reason: 'The draw block is not mined yet; try again in a few seconds.' };
      return { ready: false, reason: k ? `Round ${k.round + 1} is not due (${k.state}${k.deadline ? `, deadline ${k.deadline}` : ''}).` : 'No round left.' };
    }
    const step = c.drawMode && k.round + 1 < c.size ? (k.state === 'due' ? 'start the draw (then close again a few seconds later to draw and pay)' : 'draw and pay') : 'pay out';
    const t = tx(GILIRAN, encodeClose(c.id, BigInt(k.round)), { action: `open round ${k.round + 1}: ${step}`, circle: num(c.id) });
    return a.from ? preflight(fromOf(a), t) : t;
  },
  async cancel(a) {
    const c = await circle(idOf(a));
    if (c.cancelled || c.now < c.startAt || c.joinedCount === c.size) return { ready: false, reason: c.cancelled ? 'This circle was already cancelled; joiners were repaid.' : 'Only a circle that did not fill by its join deadline can be cancelled, and only after that deadline.' };
    const t = tx(GILIRAN, encodeCancel(c.id), { action: 'cancel: every joiner gets their first payment back', circle: num(c.id), refunds: `${c.joinedCount} × ${usdt(c.contribution)}` });
    return a.from ? preflight(fromOf(a), t) : t;
  },
  async record(a) {
    const [paid, missed, missedAfterPot, completed] = words(await call(GILIRAN, encode(SEL.recordOfName, [['string', name(a.name)]]))).map((w) => Number(u(w)));
    return { name: `${name(a.name)}.ai`, roundsPaid: paid, roundsMissed: missed, missedAfterReceiving: missedAfterPot, circlesCompleted: completed };
  },
  async inbox(a) {
    const me = name(a.name);
    if (!LABEL.test(me)) throw new TermsError('name', 'Give your .ai name, for example --name ayu.');
    const mine = await circlesWith(me);
    const circles = [];
    for (const id of mine) {
      const c = await circle(id);
      const i = c.labels.indexOf(me);
      const joined = (await callU(GILIRAN, encode(SEL.joined, [['uint', c.id], ['uint', i]]))) === 1n;
      const e = inboxEntry({ ...c, startAt: Number(c.startAt), period: Number(c.period), now: Number(c.now) }, i, joined, running(c) ? await plan(c, i) : null, await openRound(c));
      if (!e) continue;
      circles.push({
        circle: num(c.id), dues: usdt(c.contribution), ...e,
        ...(e.action === 'join' ? { organizer: `${await organizerOf(c)}.ai`, members: c.labels.map((l) => `${l}.ai`) } : {}),
        ...(e.by ? { by: when(e.by) } : {}), ...(e.opensAt ? { opensAt: when(e.opensAt) } : {}),
        ...(e.yourTurn ? { yourTurn: { round: e.yourTurn.round, at: when(e.yourTurn.at) } } : {}),
        invite: `${SITE}/?c=${num(c.id)}`,
      });
    }
    return { name: `${me}.ai`, circles, ...(circles.length ? {} : { note: 'No open Giliran circle has this name in it.' }) };
  },
  async calendar(a) {
    const c = await circle(idOf(a));
    if (c.cancelled || c.closedRounds >= c.size) return { ready: false, reason: c.cancelled ? 'This circle was cancelled.' : 'This circle has finished.' };
    const me = a.name ? name(a.name) : null;
    const i = me ? c.labels.indexOf(me) : -1;
    if (me && i < 0) throw new TermsError('name', `${me}.ai is not in this circle.`);
    const p = i < 0 ? null : await plan(c, i);
    const paid = p ? settledRounds(p) : [];
    const lang = a.lang === 'id' ? 'id' : 'en';
    const ics = calendarIcs({
      circle: num(c.id), contract: GILIRAN, labels: c.labels, period: Number(c.period), startAt: Number(c.startAt), drawMode: c.drawMode,
      due: usdt(c.contribution), link: `${SITE}/?c=${num(c.id)}&lang=${lang}`, now: Number(c.now), lang, me, paid, closedRounds: c.closedRounds, joinedCount: c.joinedCount,
    });
    if (!ics) return { ready: false, reason: c.now >= c.startAt && c.joinedCount < c.size ? 'Not everyone joined by the deadline, so no round will run. Nothing comes back by itself: any member can cancel it (node giliran.mjs cancel) and every joiner is repaid.' : 'No deadline is left in this circle.' };
    const file = resolve(a.out ?? `giliran-circle-${num(c.id)}.ics`);
    writeFileSync(file, ics);
    return {
      file, deadlines: ics.match(/BEGIN:VEVENT/g).length,
      open: { macOS: `open "${file}"`, windows: `start "" "${file}"`, googleCalendar: 'calendar.google.com, Settings, Import & export, Import' },
    };
  },
  async stats() {
    const [circles, payers, payments, paidIn, rounds] = words(await call(GILIRAN, SEL.stats)).map(u);
    return { circles: Number(circles), agentIdWalletsThatPaid: Number(payers), payments: Number(payments), paidIn: usdt(paidIn), roundsClosed: Number(rounds) };
  },
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = {};
  for (let i = 0; i < rest.length; i += 2) a[rest[i].replace(/^--/, '')] = rest[i + 1];
  if (!commands[cmd]) {
    console.log(JSON.stringify({ error: 'usage', message: `Commands: ${Object.keys(commands).join(', ')}` }));
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(await commands[cmd](a), (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  } catch (e) {
    console.log(JSON.stringify({ error: e.field ?? 'chain', message: e.message }));
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
