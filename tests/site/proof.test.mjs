import { readFileSync } from 'node:fs';
// The proof page: counters and circles read from the Giliran contract, and a .ai name's payment record.
import { startSite, GILIRAN } from './mock-chain.mjs';
import { launch, checks, SITE, speak } from './browser.mjs';

const c = (o) => ({ contribution: 10n ** 19n, period: 86_400, startAt: 1_800_000_000, drawMode: false, guaranteeDues: 1, labels: ['a', 'b', 'c', 'd', 'e'], joined: [true, true, true, true, true], closedRounds: 2, cancelled: false, ...o });
const w = (n) => BigInt(n).toString(16).padStart(64, '0');
const PAID = '0x862f86e78e31117319e23bb76bc0f3cfc0358239f7eb12997f9ce3bdc2733616';
const CLOSED = '0x6079b6dfa9213430f8e4342e17306fbcc675060fba4b9a1fa4df118a2be622d6';
const REFUNDED = '0x7ca5472b7ea78c2c0141c5a12ee6d170cf4ce8ed06be3d22c8252ddfc7a6a2c4';
const DEPLOY_BLOCK = Number(readFileSync(new URL('../../site/config.js', import.meta.url), 'utf8').match(/fromBlock:\s*(\d+)/)[1]);
const at = (k) => '0x' + (DEPLOY_BLOCK + k).toString(16); // after the deploy block, where the page reads from
const tx = (k) => '0x' + String(k).repeat(64).slice(0, 64);
const logs = [
  { blockNumber: at(0x10), transactionHash: tx(1), topics: [PAID, '0x' + w(0), '0x' + w(0), '0x' + w(0)], data: '0x' + w(0xabc) + w(10n ** 19n) },
  { blockNumber: at(0x11), transactionHash: tx(2), topics: [PAID, '0x' + w(0), '0x' + w(0), '0x' + w(1)], data: '0x' + w(0xabd) + w(10n ** 19n) },
  { blockNumber: at(0x20), transactionHash: tx(3), topics: [CLOSED, '0x' + w(0), '0x' + w(0)], data: '0x' + w(128) + w(0xabc) + w(5n * 10n ** 19n) + w(0) + w(1) + '61'.padEnd(64, '0') },
  { blockNumber: at(0x30), transactionHash: tx(4), topics: [REFUNDED, '0x' + w(1), '0x' + w(0xabe)], data: '0x' + w(10n ** 19n) },
];
const chain = { logs, circles: [c(), c({ labels: ['x', 'y', 'z'], joined: [true, false, false], closedRounds: 0, cancelled: true })], stats: [2, 31, 47, 100n * 10n ** 18n, 2], record: [5, 1, 0, 1] };
let site = await startSite(chain);
const b = await launch();
const p = await b.newPage();
await speak(p, 'id-ID'); // most suites read the Indonesian copy; the language choice itself is tested in composer
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const { ok, done } = checks();
const text = (sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const ready = () => p.waitForFunction(() => document.querySelector('[data-proof]')?.dataset.state, { timeout: 5000 }).catch(() => {});

await p.setViewport({ width: 1440, height: 900 });
{
  const ctx = await b.createBrowserContext();
  const pg = await ctx.newPage();
  await speak(pg, 'en-US');
  await pg.goto(site.base + 'proof.html', { waitUntil: 'networkidle0' });
  ok('the proof page opens in English on an English browser', (await pg.$eval('h1', (e) => e.textContent.trim())) === 'Proof on BNB Chain');
  await ctx.close();
}
{
  // one payer reads in the singular (the live page said "1 Agent ID wallets have paid")
  const one = await startSite({ ...chain, stats: [1, 1, 1, 10n ** 16n, 0] });
  const ctx = await b.createBrowserContext();
  const pg = await ctx.newPage();
  await speak(pg, 'en-US');
  await pg.goto(one.base + 'proof.html', { waitUntil: 'networkidle0' });
  await pg.waitForFunction(() => document.querySelector('[data-proof-goal]')?.textContent, { timeout: 5000 }).catch(() => {});
  const goal = await pg.$eval('[data-proof-goal]', (e) => e.textContent.trim());
  ok('one payer reads in the singular', goal.startsWith('1 Agent ID wallet has paid its dues'), goal);
  await ctx.close();
  await one.close?.();
}
await p.goto(site.base + 'proof.html', { waitUntil: 'networkidle0' });
await ready();
const nums = await text('[data-proof-stats]');
ok('shows Agent ID wallets that paid', nums.includes('31'), nums);
ok('shows circles, payments, kocokan and USDT paid in', nums.includes('2') && nums.includes('47') && nums.includes('100'), nums);
ok('says in a sentence how many Agent ID wallets paid', /31 dompet Agent ID sudah bayar/.test(await text('[data-proof-goal]')), await text('[data-proof-goal]'));
const links = await p.$$eval('[data-proof-circles] a', (as) => as.map((a) => a.getAttribute('href')));
ok('every circle links to its invite page, newest first', links.join(' ') === './?c=2 ./?c=1', links.join(' '));
ok('a cancelled circle is marked', /dibatalkan/i.test(await text('[data-proof-circles]')), await text('[data-proof-circles]'));
ok('the contract links to its verified code', (await p.$eval('[data-proof-factory]', (a) => a.href)).endsWith(`${GILIRAN}#code`));
ok('the newest circle is drawn as a ring', (await p.$$eval('[data-proof-ring] .node', (n) => n.length)) === 3);
const pay = await p.$$eval('[data-proof-payments] li', (li) => li.map((l) => ({ t: l.textContent.replace(/\s+/g, ' ').trim(), href: l.querySelector('a')?.href })));
ok('every payment, kocokan and refund is listed newest first with its BscScan transaction', pay.length === 4 && pay[0].href === `https://bscscan.com/tx/${tx(4)}` && pay[3].href === `https://bscscan.com/tx/${tx(1)}`, JSON.stringify(pay));
ok('the rows say what happened, in USDT', /dikembalikan/.test(pay[0].t) && /50 USDT/.test(pay[1].t) && /10 USDT/.test(pay[3].t), pay.map((x) => x.t).join(' / '));
ok('the payment rows never name a member next to a transaction', pay.every((x) => !/\b[a-z]\.ai\b/.test(x.t)), pay.map((x) => x.t).join(' / '));
const tops = await p.$$eval('[data-proof-stats] dt', (dt) => dt.map((d) => Math.round(d.getBoundingClientRect().bottom))); // the lead number is larger on purpose; the labels share a line
ok('the counter labels line up', new Set(tops).size === 1, tops.join(','));
ok('the record placeholder is readable (theme muted, not the browser grey)', (await p.$eval('#record-name', (e) => getComputedStyle(e, '::placeholder').color)) !== 'rgb(117, 117, 117)', await p.$eval('#record-name', (e) => getComputedStyle(e, '::placeholder').color));
ok('the proof page has the footer with the risk line', /nggak bisa dibatalkan/.test(await text('.foot__risk')));
ok('all transactions are one link away', (await p.$eval('[data-proof-alltx]', (a) => a.href).catch(() => '')) === `https://bscscan.com/address/${GILIRAN}`);
await p.type('#record-name', 'Sari.ai');
await p.click('[data-record] button');
await p.waitForFunction(() => document.querySelector('[data-record-out]').textContent.length > 0);
ok('a name record is read by name, and a miss is called a miss, not lateness', /sari\.ai sudah bayar 5 kali, terlewat 1 kali/.test(await text('[data-record-out]')), await text('[data-record-out]'));
await p.$eval('#record-name', (e) => { e.value = 'bad name!'; });
await p.click('[data-record] button');
ok('a malformed name is explained, not looked up', /Tulis nama \.ai/.test(await text('[data-record-out]')), await text('[data-record-out]'));
const switchTo = async (l) => { await p.click('[data-lang-toggle]'); await p.waitForFunction((x) => document.documentElement.lang === x, {}, l); await new Promise((r) => setTimeout(r, 400)); }; // the swap plays a view transition; a click during it is lost
await switchTo('en');
ok('switches to English', /Payers, all time/.test(await text('[data-proof-stats]')) && /cancelled/i.test(await text('[data-proof-circles]')), await text('[data-proof-stats]'));
await switchTo('id');

await p.goto(site.base, { waitUntil: 'networkidle0' });
ok('the home page links to the proof page and the record check', (await p.$$eval('a[href="./proof.html"]', (a) => a.length)) > 0 && (await p.$$eval('a[href="./proof.html#riwayat"]', (a) => a.length)) > 0);

site.close();
site = await startSite(chain, { configured: false });
await p.goto(site.base + 'proof.html', { waitUntil: 'networkidle0' });
await ready();
ok('before deploy there is no payment list', (await p.$$eval('[data-proof-payments] li', (l) => l.length)) === 0);
ok('before deploy it says so instead of showing zeros', /belum/i.test(await text('[data-proof-note]')) && !(await text('[data-proof-stats]')).includes('31'), await text('[data-proof-note]'));
site.close();

// the newest circle filled before its start, and its last join paid round 1 out: the ring is round 2's
site.close();
const NOW = Math.floor(Date.now() / 1000);
chain.circles.push(c({ startAt: NOW + 2 * 86_400, closedRounds: 1, recipients: [0], paid: { 0: [true, true, true, true, true] } }));
chain.stats[0] = chain.circles.length; // stats() is where the page learns how many circles there are
site = await startSite(chain);
await p.goto(site.base + 'proof.html', { waitUntil: 'networkidle0' });
await ready();
const cap = await text('[data-proof-ring-cap]');
const center = await p.$$eval('[data-proof-ring] .ring__k, [data-proof-ring] .ring__amount', (e) => e.map((x) => x.textContent).join(' '));
ok('a circle whose round 1 paid out shows round 2’s own count, not round 1’s money', /Putaran ke-2/.test(center) && /^Putaran ke-2 0/.test(center) && !/50 dari 50/.test(cap), center + ' / ' + cap);
chain.circles.pop();
chain.stats[0] = chain.circles.length;
site.close();
site = await startSite(chain);

chain.logsFail = true;
site = await startSite(chain);
await p.goto(site.base + 'proof.html', { waitUntil: 'networkidle0' });
await ready();
ok('if the logs cannot be read, the counters still show and the list points to BscScan', (await text('[data-proof-stats]')).includes('31') && (await p.$$eval('[data-proof-payments] li', (l) => l.length)) === 0 && (await p.$eval('.proof__cap-link', (a) => a.href).catch(() => '')) === `https://bscscan.com/address/${GILIRAN}`, await text('.proof__cap'));
chain.logsFail = false;
site.close();
site = await startSite(chain);
await p.setViewport({ width: 375, height: 812 });
await p.goto(site.base + 'proof.html', { waitUntil: 'networkidle0' });
await ready();
ok('no horizontal scroll at 375', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
ok('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
site.close();
done();
