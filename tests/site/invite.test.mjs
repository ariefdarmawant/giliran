// The invite link: giliran-app.vercel.app/?c=<circle number> is its own page: the circle read from chain, your seat, the steps to
// join, the sentence for your agent and the risk line beside it.
import { startSite } from './mock-chain.mjs';
import { launch, checks, SITE, speak } from './browser.mjs';

const START = 1_900_000_000;
const circle = (o) => ({ contribution: 10n ** 19n, period: 2_592_000, startAt: START, drawMode: true, guaranteeDues: 1, labels: ['rina', 'dodi', 'sari'], joined: [true, true, false], closedRounds: 0, cancelled: false, ...o });
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const U = 10n ** 18n;
const five = (o) => circle({ contribution: 10n * U, period: 7 * DAY, startAt: NOW + 2 * DAY, drawMode: false, guaranteeDues: 0, labels: ['rina', 'dodi', 'sari', 'fajar', 'mega'], joined: [true, true, true, true, true], ...o });
const all = (n) => Array(n).fill(true);
// the round states, each one circle (its number is its place in this list, from 1)
const states = {
  lastOverdue: five({ startAt: NOW - 30 * DAY, closedRounds: 4, recipients: [0, 1, 2, 3], paid: { 4: [true, true, true, false, false] } }), // #4
  fullDraw: five({ drawMode: true, paid: { 0: all(5) }, drawBlock: { 0: 135370256 + 99990 } }), // #5: the last join scheduled the draw
  runDrawPending: five({ drawMode: true, startAt: NOW - 3600, paid: { 0: all(5) }, drawBlock: { 0: 135370256 + 99990 } }), // #6
  unfilled: five({ startAt: NOW - DAY, joined: [true, true, true, false, false] }), // #7
  fullFixed: five({ closedRounds: 1, recipients: [0], paid: { 0: all(5) } }), // #8: the last join paid round 1 to rina
  payouts: five({ startAt: NOW - 3 * DAY, closedRounds: 2, recipients: [0, 1], payouts: { 1: 40n * U }, paid: { 2: [true, false, false, false, false] }, covered: { 2: [false, true, false, false, false] } }), // #9
  finished: five({ startAt: NOW - 120 * DAY, period: 30 * DAY, closedRounds: 5, recipients: [0, 1, 2, 3, 4] }), // #10
  joiningFar: five({ startAt: NOW + 50 * DAY, joined: [true, false, false, false, false] }), // #11
  running: five({ startAt: NOW - 3 * DAY, closedRounds: 1, recipients: [0], paid: { 1: [true, true, false, false, false] } }), // #12
  cents: five({ contribution: 7n * 10n ** 16n, joined: [true, true, true, false, false] }), // #13: 0.07 USDT dues
};
const chain = { circles: [circle(), circle({ cancelled: true }), circle({ drawMode: false, period: 86_400 }), ...Object.values(states)] };
const num = (k) => String(Object.keys(states).indexOf(k) + 4);
const site = await startSite(chain);
const b = await launch();
const p = await b.newPage();
await speak(p, 'id-ID'); // most suites read the Indonesian copy; the language choice itself is tested in composer
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const { ok, done } = checks();
const text = (sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const visible = (sel) => p.$eval(sel, (e) => !e.hidden && e.getClientRects().length > 0).catch(() => false);
const settle = () => p.waitForFunction(() => !['', 'loading', undefined].includes(document.querySelector('[data-invite]')?.dataset.state), { timeout: 8000 }).catch(() => {});

await p.setViewport({ width: 1440, height: 900 });
await p.goto(site.base, { waitUntil: 'networkidle0' });
ok('no invite without ?c', !(await visible('[data-invite]')));
ok('the landing shows without ?c', await visible('.hero'));

await p.goto(`${site.base}?c=1`, { waitUntil: 'networkidle0' });
await settle();
ok('invite is shown for a circle link', await visible('[data-invite]'));
ok('the invite is its own page: no hero, no FAQ, no start button in the nav', !(await visible('.hero')) && !(await visible('#tanya')) && !(await visible('.nav__cta')));
ok('the footer and its risk line stay', /nggak bisa dibatalkan/.test(await text('.foot__risk')) && (await visible('.foot__risk')));
ok('the page title says you are invited, with the circle number', (await text('[data-invite] h1')) === 'Kamu diundang ke arisan #1', await text('[data-invite] h1'));
const terms = await text('[data-invite-terms]');
ok('terms give dues, schedule, order and jaminan', terms.includes('10 USDT') && /bulan/i.test(terms) && /dikocok/i.test(terms) && /1 iuran berikutnya/.test(terms), terms);
ok('the join deadline says how far away it is', /dalam \d/.test(terms), terms);
ok('the real circle is drawn: 3 members, 2 joined', (await p.$$eval('[data-invite-ring] .node', (n) => n.length)) === 3 && (await p.$$eval('[data-invite-ring] .node--paid', (n) => n.length)) === 2);
const members = await p.$$eval('[data-invite-members] li', (li) => li.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
ok('each member is listed with whether they joined', members.length === 3 && /rina\.ai.*sudah ikut/i.test(members[0]) && /sari\.ai.*belum ikut/i.test(members[2]), members.join(' / '));
ok('says how many have joined', (await text('[data-invite-joined]')).includes('2 dari 3'), await text('[data-invite-joined]'));
ok('what you pay in and take out', /10 USDT tiap putaran, 3 kali/.test(await text('[data-invite-total]')) && /dapat 30 USDT/.test(await text('[data-invite-total]')), await text('[data-invite-total]'));
const steps = await p.$$eval('[data-invite-steps] li', (li) => li.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
ok('three steps: get ready (with Developer Mode), copy, paste to the agent who asks before paying the dues', steps.length === 3 && /Developer Mode/.test(steps[0]) && /Agentic Wallet/.test(steps[2]) && /10 USDT/.test(steps[2]), steps.join(' / '));
ok('sentence to join names the circle', (await text('[data-invite-say]')) === 'Ikut arisan Giliran #1.', await text('[data-invite-say]'));
ok('copy button is ready', await p.$eval('[data-invite-copy]', (e) => !e.disabled));
ok('the risk line sits right under the copy button', /nggak bisa dibatalkan/.test(await text('[data-invite-risk]')) && (await visible('[data-invite-risk]')));
ok('explains the first iuran comes back if it does not fill', /kembali/i.test(await text('[data-invite-note]')), await text('[data-invite-note]'));
const share = await p.$eval('[data-invite-share]', (a) => a.href).catch(() => '');
ok('the invite can be sent to WhatsApp, in the language it was read in', share.startsWith('https://wa.me/?text=') && decodeURIComponent(share).includes('giliran-app.vercel.app/?c=1&lang=id'), share);
const switchTo = async (l) => { await p.click('[data-lang-toggle]'); await p.waitForFunction((x) => document.documentElement.lang === x, {}, l); await new Promise((r) => setTimeout(r, 400)); }; // the swap plays a view transition; a click during it is not a click
await switchTo('en');
ok('invite switches to English', (await text('[data-invite-say]')) === 'Join Giliran circle #1.' && /monthly/i.test(await text('[data-invite-terms]')) && /joined/.test(await text('[data-invite-members]')), await text('[data-invite-terms]'));
await switchTo('id');

await p.goto(`${site.base}?c=3`, { waitUntil: 'networkidle0' });
await settle();
const fixed = await p.$$eval('[data-invite-members] li', (li) => li.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
ok('a fixed-order circle shows each member’s kocokan', /putaran ke-1/.test(fixed[0]) && /putaran ke-3/.test(fixed[2]), fixed.join(' / '));

await p.goto(`${site.base}?c=2`, { waitUntil: 'networkidle0' });
await settle();
ok('a cancelled circle says so and offers no sentence', /dibatalkan/i.test(await text('[data-invite-note]')) && !(await visible('[data-invite-say]')) && !(await visible('[data-invite-steps]')), await text('[data-invite-note]'));
ok('a cancelled circle is not titled as an invitation, and carries its number', !/diundang/.test(await text('[data-invite] h1')) && /#2/.test(await text('[data-invite] h1')), await text('[data-invite] h1'));
await p.goto(`${site.base}?c=99`, { waitUntil: 'networkidle0' });
await settle();
ok('a number with no circle is not treated as one', /belum ada arisan #99/i.test(await text('[data-invite-note]')) && !(await visible('[data-invite-say]')), await text('[data-invite-note]'));
ok('a missing circle is titled as not found', /nggak ketemu/i.test(await text('[data-invite] h1')), await text('[data-invite] h1'));
await p.goto(`${site.base}?c=not-a-number`, { waitUntil: 'networkidle0' });
await settle();
ok('a malformed link is not treated as a circle', /bukan arisan giliran/i.test(await text('[data-invite-note]')), await text('[data-invite-note]'));

chain.delay = 1500;
await p.goto(`${site.base}?c=1`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('[data-invite]:not([hidden])');
ok('while reading the chain it says so', /Membaca/.test(await text('[data-invite-note]')), await text('[data-invite-note]'));
await settle();
chain.delay = 0;

chain.fail = true;
await p.goto(`${site.base}?c=1`, { waitUntil: 'networkidle0' });
await settle();
ok('a chain error offers a retry', /coba lagi/i.test(await text('[data-invite-note]')) && (await visible('[data-invite-retry]')), await text('[data-invite-note]'));
chain.fail = false;
await p.click('[data-invite-retry]');
await p.waitForFunction(() => document.querySelector('[data-invite]').dataset.state === 'joining', { timeout: 8000 }).catch(() => {});
ok('retry reads the circle', (await text('[data-invite-say]')) === 'Ikut arisan Giliran #1.', await text('[data-invite-say]'));

// the states a circle goes through on chain, as the page must read them
const dated = (dts) => dts.some((d) => /Ikut paling lambat|Putaran sekarang|dibuka/.test(d)); // a row that carries a date
const look = async (k) => {
  await p.goto(`${site.base}?c=${num(k)}`, { waitUntil: 'networkidle0' });
  await settle();
  return p.evaluate(() => {
    const tx = (s) => [...document.querySelectorAll(s)].filter((e) => !e.hidden && e.getClientRects().length).map((e) => e.textContent.replace(/\s+/g, ' ').trim());
    return { state: document.querySelector('[data-invite]').dataset.state, terms: tx('[data-invite-terms]').join(' '), dts: tx('[data-invite-terms] dt'), members: tx('[data-invite-members] li'), say: tx('[data-invite-say]')[0] ?? '', steps: tx('[data-invite-steps] li'), note: tx('[data-invite-note]')[0] ?? '', act: tx('.invite__act-title')[0] ?? '', center: tx('[data-invite-ring] .ring__amount').length, page: document.querySelector('[data-invite]').innerText };
  });
};
let s = await look('lastOverdue');
ok('a round past its deadline that nobody pays into is ready to open, with the message that opens it', s.state === 'open' && s.say === `Buka kocokan arisan Giliran #${num('lastOverdue')}.`, JSON.stringify(s));
ok('it says anyone can open it, and that a late payment still counts until then', /siapa pun/i.test(s.note) && /masih dihitung/i.test(s.steps.join(' ') + s.note), s.note + ' / ' + s.steps.join(' / '));
ok('the waiting recipient is not told to wait for a deadline that has passed', !/lewat batas waktunya/.test(s.members[4]) && /buka/i.test(s.members[4]), s.members[4]);
s = await look('fullDraw');
ok('a drawn circle that filled has its draw scheduled, not paid: ready to open, no claim it is paid out', s.state === 'open' && !/langsung dibayarkan/.test(s.page) && /kocokan/i.test(s.note) && s.say === `Buka kocokan arisan Giliran #${num('fullDraw')}.`, s.note);
s = await look('runDrawPending');
ok('after the start, a pending draw is not shown as a late round', s.state === 'open' && !/lewat batas waktu/.test(s.terms + s.note) && /kocokan/i.test(s.note), s.terms + ' / ' + s.note);
s = await look('unfilled');
ok('a circle that did not fill is not called refunded: anyone can cancel it, with the message that does', s.state === 'unfilled' && !/otomatis/i.test(s.page) && /siapa pun/i.test(s.note) && s.say === `Batalkan arisan Giliran #${num('unfilled')}.`, s.note + ' / ' + s.say);
ok('a circle that did not fill shows no payout dates, no date row and no ring total', !s.members.some((m) => /Narik/.test(m)) && !dated(s.dts) && s.center === 0, s.members.join(' / '));
s = await look('fullFixed');
ok('a fixed circle that filled before the start: the date is when round 2 dues open', s.state === 'full' && s.dts.some((d) => /putaran ke-2/i.test(d)) && !s.dts.some((d) => /Ikut paling lambat/.test(d)), s.dts.join(' / '));
ok('round 1 is shown as paid to its recipient', /rina\.ai/.test(s.note) && /Sudah terima 50 USDT di putaran ke-1/.test(s.members[0]), s.note + ' / ' + s.members[0]);
s = await look('payouts');
ok('a payout shows what the recipient actually received', /Sudah terima 40 USDT di putaran ke-2/.test(s.members[1]), s.members[1]);
ok('a due paid from a payout is marked as paid by the guarantee', /Dibayar jaminan/.test(s.members[1]), s.members[1]);
ok('the contract’s removed guaranteeOf is never read', !chain.seen.selectors.has('0x64c5f5a5'));
s = await look('running');
ok('the running steps also tell someone who already paid this round what a payment would do', s.state === 'running' && s.steps.some((x) => /sudah bayar/i.test(x) && /berikutnya/.test(x)), s.steps.join(' / '));
s = await look('cents');
const centsTotal = await text('[data-invite-total]');
ok('dues under 1 USDT read in Indonesian decimals, and five of them add up exactly', /0,07\sUSDT/.test(s.terms) && /0,35\sUSDT/.test(centsTotal) && !/0000/.test(s.terms + centsTotal), s.terms + ' | ' + centsTotal);
s = await look('finished');
ok('a finished circle shows no ring total and no date row', s.state === 'finished' && s.center === 0 && !dated(s.dts), JSON.stringify(s.dts));
s = await look('joiningFar');
ok('a deadline weeks away is said in months', /dalam 2 bulan/.test(s.terms), s.terms);
ok('in a fixed circle, round 1 pays once everyone has joined, not on a date', /putaran ke-1, begitu semua ikut/.test(s.members[0]), s.members[0]);
ok('nothing on a joining page promises an automatic refund', !/otomatis/i.test(s.page), s.note);

// the chain is read in batches, and still read where a node refuses batches
const before = chain.seen.posts;
await look('running');
ok('a circle is read in a few batched requests, not one per call', chain.seen.posts - before <= 6, String(chain.seen.posts - before));
chain.batchRefused = true;
s = await look('running');
ok('a node that refuses batches is read one call at a time', s.state === 'running', s.state);
chain.batchRefused = false;
chain.delay = 2500;
await p.goto(`${site.base}?c=1`, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 4500));
ok('a slow read says it is still reading', /masih/i.test(await text('[data-invite-note]')), await text('[data-invite-note]'));
await settle();
chain.delay = 0;

await p.setViewport({ width: 375, height: 812 });
await p.goto(`${site.base}?c=1`, { waitUntil: 'networkidle0' });
await settle();
ok('no horizontal scroll at 375 with an invite', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
ok('at 375 the copy button is within the first two screens', (await p.$eval('[data-invite-copy]', (e) => e.getBoundingClientRect().top)) < 812 * 2, String(await p.$eval('[data-invite-copy]', (e) => e.getBoundingClientRect().top)));
ok('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
site.close();
done();
