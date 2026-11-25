// A static server for the site plus a fake BNB Chain JSON-RPC that answers the Giliran contract's views.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

import { SITE } from './browser.mjs';
// the deploy block the site reads events from, so the mock head always sits past it
const DEPLOY_BLOCK = Number(readFileSync(new URL('../../site/config.js', import.meta.url), 'utf8').match(/fromBlock:\s*(\d+)/)[1]);
export const GILIRAN = '0xFaC7000000000000000000000000000000000001';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const strings = (list) => {
  let offs = '', body = '';
  for (const s of list) { offs += word(list.length * 32 + body.length / 2); const h = Buffer.from(s).toString('hex'); body += word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0'); }
  return '0x' + word(32) + word(list.length) + offs + body;
};
const string = (s) => { const h = Buffer.from(s).toString('hex'); return '0x' + word(32) + word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0'); };

/**
 * chain: { fail, logsFail, delay (ms per RPC answer), batchRefused (answer a JSON-RPC batch with an error, as some
 * nodes do), head (block number, hex), logs: [eth_getLogs entries], stats: [5 numbers], record: [4 numbers],
 * circles: [{ contribution, period, startAt, drawMode, guaranteeDues, labels, joined:[bool], closedRounds, cancelled,
 *   paid: {round: [bool]}, covered: {round: [bool]}, recipients: [member per closed round], payouts: {round: wei},
 *   drawBlock: {round: block}, organizer }] }
 * Counts what the page asked in chain.seen: { posts, batches, calls, selectors: Set }.
 * Selectors the contract no longer has (guaranteeOf) revert, as they would on chain.
 */
export async function startSite(chain, { configured = true } = {}) {
  let port;
  chain.seen = { posts: 0, batches: 0, calls: 0, selectors: new Set() };
  const answer = (data) => {
    const sel = data.slice(0, 10);
    chain.seen.selectors.add(sel);
    const args = (data.slice(10).match(/.{64}/g) ?? []).map((w) => BigInt('0x' + w));
    const c = chain.circles?.[Number(args[0])];
    const flag = (map, r, i) => Boolean(map?.[Number(r)]?.[Number(i)]);
    switch (sel) {
      case '0xcf0b1117': return '0x' + word(chain.circles?.length ?? 0); // circleCount()
      case '0x65f75746': return c ? '0x' + [c.contribution, c.period, c.startAt, c.drawMode ? 1 : 0, c.guaranteeDues, c.labels.length, c.joined.filter(Boolean).length, c.closedRounds, c.cancelled ? 1 : 0].map(word).join('') : null; // circleInfo(id)
      case '0xf25fed48': return c ? strings(c.labels) : null; // labels(id)
      case '0xd5ae1e0a': return '0x' + word(c?.joined[Number(args[1])] ? 1 : 0); // joined(id, i)
      case '0x628a55ca': return '0x' + word(flag(c?.paid, args[1], args[2]) ? 1 : 0); // paid(id, r, i)
      case '0x715a708f': return '0x' + word(flag(c?.covered, args[1], args[2]) ? 1 : 0); // covered(id, r, i)
      case '0xc4f1cc06': { // paidCount(id, r): paid or covered
        const r = Number(args[1]);
        return '0x' + word(c ? c.labels.filter((_, i) => flag(c.paid, r, i) || flag(c.covered, r, i)).length : 0);
      }
      case '0x8a948428': return '0x' + word(c?.recipients?.[Number(args[1])] ?? 0); // recipientOf(id, r)
      case '0xa19b6ff6': { // payoutOf(id, r): the whole pot unless the test says otherwise
        const r = Number(args[1]);
        if (!c || r >= c.closedRounds) return '0x' + word(0);
        return '0x' + word(c.payouts?.[r] ?? c.contribution * BigInt(c.labels.length));
      }
      case '0x8428574e': return '0x' + word(c?.drawBlock?.[Number(args[1])] ?? 0); // drawBlockOf(id, r)
      case '0x1e6e146b': return c ? string(c.organizer ?? c.labels[0]) : null; // organizerOf(id)
      case '0xb8945670': return '0x' + word(1); // claimed(label)
      case '0xd80528ae': return '0x' + chain.stats.map(word).join(''); // stats()
      case '0x4f8456ee': return '0x' + (chain.record ?? [0, 0, 0, 0]).map(word).join(''); // recordOfName: a clean record unless the test sets one
      default: return null; // not a view of this contract (guaranteeOf is gone): reverts
    }
  };
  const one = ({ id, method, params }) => {
    chain.seen.calls++;
    // logs are filtered to the asked block window, as a real node does; the head sits past the deploy block
    const inWin = (l) => { const b = BigInt(l.blockNumber ?? 0), q = params[0] ?? {}; return (!q.fromBlock || b >= BigInt(q.fromBlock)) && (!q.toBlock || q.toBlock === 'latest' || b <= BigInt(q.toBlock)); };
    const result = chain.fail ? null : method === 'eth_blockNumber' ? (chain.head ?? '0x' + (DEPLOY_BLOCK + 100000).toString(16))
      : method === 'eth_getLogs' ? (chain.logsFail ? null : (chain.logs ?? []).filter(inWin)) : answer(params[0].data);
    return result === null ? { jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted' } } : { jsonrpc: '2.0', id, result };
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/rpc') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        chain.seen.posts++;
        const parsed = JSON.parse(body);
        let out;
        if (Array.isArray(parsed)) {
          chain.seen.batches++;
          out = chain.batchRefused ? { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'batch requests are not supported' } } : parsed.map(one);
        } else out = one(parsed);
        setTimeout(() => res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify(out)), chain.delay ?? 0);
      });
      return;
    }
    if (req.method === 'OPTIONS') return res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }).end();
    const file = join(SITE, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!existsSync(file)) return res.writeHead(404).end();
    let body = readFileSync(file);
    if (url.pathname === '/config.js') {
      const g = configured ? GILIRAN : '';
      body = String(body).replace(/giliran: '[^']*'/, `giliran: '${g}'`).replace(/(rpc|logRpc): \[[^\]]*\]/g, (_, k) => `${k}: ['http://127.0.0.1:${port}/rpc']`);
      // tests decide the skill command themselves (empty unless a test sets one), whatever the real config holds
      body = body.replace(/skill: '[^']*'/, `skill: '${chain.skill ?? ''}'`);
      body = Buffer.from(body);
    }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  return { base: `http://127.0.0.1:${port}/`, close: () => server.close() };
}
