// End to end on a local fork of BNB Chain (real USDT): every transaction is built by giliran.mjs and sent the
// way an Agentic Wallet would, from the member's own key. Only the Agent ID registry is replaced by a mock at
// its address, so test keys can hold names. Needs Foundry (anvil, cast) and `forge build` in contracts/.
//   FORK_E2E=1 node --test skills/giliran/scripts/e2e.fork.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ON = !!process.env.FORK_E2E;
const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = (f, n) => JSON.parse(readFileSync(new URL(`../../../contracts/out/${f}/${n}.json`, import.meta.url), 'utf8'));
const FORK = process.env.FORK_URL ?? 'https://bsc-rpc.publicnode.com';
const PORT = 19545 + Math.floor(Math.random() * 400);
const RPC = `http://127.0.0.1:${PORT}`;
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const AGENT_ID = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F';
const KEYS = ['0x' + '11'.repeat(32), '0x' + '22'.repeat(32), '0x' + '33'.repeat(32), '0x' + '44'.repeat(32)];
const NAMES = ['e2e-ayu', 'e2e-budi', 'e2e-citra'];

const cast = (...a) => execFileSync('cast', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: '1' } }).trim();
const addr = (k) => cast('wallet', 'address', '--private-key', k);
let anvil, giliran;
const helper = (...a) => {
  try {
    return JSON.parse(execFileSync('node', [`${HERE}giliran.mjs`, ...a], { encoding: 'utf8', env: { ...process.env, GILIRAN_ADDRESS: giliran, GILIRAN_RPC: RPC } }));
  } catch (e) { return JSON.parse(e.stdout); }
};
const send = (key, t) => JSON.parse(cast('send', t.to, t.data, '--private-key', key, '--rpc-url', RPC, '--json'));
const chainNow = () => Number(cast('block', 'latest', '--field', 'timestamp', '--rpc-url', RPC));
const usdtOf = (a) => BigInt(cast('call', USDT, 'balanceOf(address)(uint256)', a, '--rpc-url', RPC).split(' ')[0]);
const warp = (s) => { cast('rpc', 'evm_increaseTime', String(s), '--rpc-url', RPC); cast('rpc', 'evm_mine', '--rpc-url', RPC); };
const mine = (n) => { for (let i = 0; i < n; i++) cast('rpc', 'evm_mine', '--rpc-url', RPC); };

before(async () => {
  if (!ON) return;
  const head = Number(cast('block-number', '--rpc-url', FORK));
  anvil = spawn('anvil', ['--fork-url', FORK, '--fork-block-number', String(head - 200), '--port', String(PORT), '--silent'], { stdio: 'ignore' });
  for (let i = 0; ; i++) {
    try { cast('block-number', '--rpc-url', RPC); break; } catch { if (i > 120) throw new Error('anvil did not start'); await new Promise((r) => setTimeout(r, 250)); }
  }
  cast('rpc', 'anvil_setCode', AGENT_ID, OUT('Mocks.sol', 'MockAgentID').deployedBytecode.object, '--rpc-url', RPC);
  for (const k of KEYS) cast('rpc', 'anvil_setBalance', addr(k), '0xDE0B6B3A7640000', '--rpc-url', RPC);
  NAMES.forEach((n, i) => cast('send', AGENT_ID, 'setOwner(string,address)', n, addr(KEYS[i]), '--private-key', KEYS[3], '--rpc-url', RPC));
  // fund each member with 50 USDT by finding USDT's balance slot
  for (const k of KEYS.slice(0, 3)) {
    const who = addr(k);
    for (let slot = 0; slot < 12; slot++) {
      const at = cast('index', 'address', who, String(slot));
      cast('rpc', 'anvil_setStorageAt', USDT, at, '0x' + (50n * 10n ** 18n).toString(16).padStart(64, '0'), '--rpc-url', RPC);
      if (usdtOf(who) === 50n * 10n ** 18n) break;
      cast('rpc', 'anvil_setStorageAt', USDT, at, '0x' + '0'.repeat(64), '--rpc-url', RPC);
    }
  }
  const g = OUT('Giliran.sol', 'Giliran');
  const created = JSON.parse(cast('send', '--private-key', KEYS[3], '--rpc-url', RPC, '--json', '--create', g.bytecode.object + USDT.slice(2).toLowerCase().padStart(64, '0')));
  giliran = created.contractAddress;
});
after(() => anvil?.kill());

test('a drawn circle, start to first round, entirely through the helper', { skip: !ON }, () => {
  const start = chainNow() + 7_200;
  const create = helper('create', '--organizer', NAMES[0], '--members', NAMES.join(','), '--due', '2', '--every', 'daily', '--order', 'draw', '--guarantee', '1', '--start', String(start));
  assert.equal(create.to.toLowerCase(), giliran.toLowerCase());
  const createTx = send(KEYS[0], create);
  assert.equal(createTx.status, '0x1');
  const { circle } = helper('created', '--tx', createTx.transactionHash);
  assert.equal(circle, 1); // people count circles from 1

  // a member who has not approved is told to approve first, before anything is sent
  assert.equal(helper('pay', '--circle', '1', '--name', NAMES[1], '--from', addr(KEYS[1])).error, 'allowance');

  NAMES.forEach((n, i) => {
    const ap = helper('approve', '--circle', '1', '--name', n, '--from', addr(KEYS[i]));
    assert.equal(ap.summary.forThisCircle, '6 USDT'); // exactly 3 rounds of 2 USDT
    assert.equal(send(KEYS[i], ap).status, '0x1');
    const pay = helper('pay', '--circle', '1', '--name', n, '--from', addr(KEYS[i]));
    // the last join fills round 1, so the user hears before their yes that it also starts the draw
    if (i === NAMES.length - 1) assert.match(pay.summary.alsoDoes, /starts the draw/);
    else assert.equal(pay.summary.alsoDoes, undefined);
    assert.equal(send(KEYS[i], pay).status, '0x1');
  });
  const s = helper('status', '--circle', '1');
  assert.deepEqual(s.joined, NAMES.map((n) => `${n}.ai`));
  assert.equal(s.round.state, 'draw_pending'); // scheduled by the last join, no separate step
  assert.equal(helper('pay', '--circle', '1', '--name', NAMES[0], '--from', addr(KEYS[0])).error, 'circle'); // already joined
  assert.equal(helper('close', '--circle', '1').ready, false); // the draw block is not mined yet

  mine(4); // no need to wait for the start: everyone has joined, so round 1 can pay out now
  const before = NAMES.map((_, i) => usdtOf(addr(KEYS[i])));
  const draw = helper('close', '--circle', '1');
  assert.match(draw.summary.action, /draw and pay/);
  assert.equal(send(KEYS[2], draw).status, '0x1');
  const gained = NAMES.map((_, i) => usdtOf(addr(KEYS[i])) - before[i]);
  assert.deepEqual(gained.filter((g) => g > 0n), [4n * 10n ** 18n]); // one member drew 6 USDT, 2 held as the guarantee

  const st = helper('status', '--circle', '1');
  assert.equal(st.organizer, `${NAMES[0]}.ai`);
  const winner = st.received[0].name;
  assert.equal(st.received[0].got, '4 USDT'); // what the winner actually got: 6 in, 2 paid their next due
  assert.ok(NAMES.map((n) => `${n}.ai`).includes(winner));
  assert.deepEqual(helper('stats'), { circles: 1, agentIdWalletsThatPaid: 3, payments: 3, paidIn: '6 USDT', roundsClosed: 1 });
  assert.equal(helper('record', '--name', winner).roundsPaid, 1);
  // round 2 dues open at the start; the winner's held due pays their round 2, so their agent is not asked to pay it
  warp(7_300);
  const w = NAMES.findIndex((n) => `${n}.ai` === winner);
  assert.match(helper('pay', '--circle', '1', '--name', NAMES[w], '--from', addr(KEYS[w])).reason, /already paid it \(the guarantee\)/);
  const other = (w + 1) % 3;
  assert.equal(helper('pay', '--circle', '1', '--name', NAMES[other], '--from', addr(KEYS[other])).summary.forRound, 2);
});

test('a circle that does not fill is cancelled and its joiners repaid', { skip: !ON }, () => {
  const start = chainNow() + 3_700;
  const tx = send(KEYS[1], helper('create', '--organizer', NAMES[1], '--members', NAMES.join(','), '--due', '1', '--every', 'weekly', '--order', 'fixed', '--guarantee', 'full', '--start', String(start)));
  const { circle } = helper('created', '--tx', tx.transactionHash);
  for (const i of [0, 1]) {
    send(KEYS[i], helper('approve', '--circle', String(circle), '--name', NAMES[i], '--from', addr(KEYS[i])));
    send(KEYS[i], helper('pay', '--circle', String(circle), '--name', NAMES[i], '--from', addr(KEYS[i])));
  }
  assert.equal(helper('cancel', '--circle', String(circle)).ready, false); // not before the first round
  warp(3_800);
  const before = [0, 1].map((i) => usdtOf(addr(KEYS[i])));
  assert.equal(send(KEYS[2], helper('cancel', '--circle', String(circle))).status, '0x1');
  [0, 1].forEach((i, k) => assert.equal(usdtOf(addr(KEYS[i])) - before[k], 10n ** 18n));
  assert.equal(helper('status', '--circle', String(circle)).cancelled, true);
});
