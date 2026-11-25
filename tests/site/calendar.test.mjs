// "Add to calendar" on the invite page: the circle's deadlines as one .ics file, built in the browser.
import { startSite } from './mock-chain.mjs';
import { launch, checks, speak } from './browser.mjs';

const START = 1_900_000_000;
const circle = (o) => ({ contribution: 10n ** 19n, period: 2_592_000, startAt: START, drawMode: false, guaranteeDues: 0, labels: ['rina', 'dodi', 'sari'], joined: [true, true, false], closedRounds: 0, cancelled: false, ...o });
const site = await startSite({ circles: [circle(), circle({ cancelled: true })], record: [0, 0, 0, 0], stats: [0, 0, 0, 0, 0] });
const b = await launch();
const p = await b.newPage();
await speak(p, 'id-ID');
// keep the text of every file the page offers for download
await p.evaluateOnNewDocument(() => {
  window.__files = [];
  const make = URL.createObjectURL;
  URL.createObjectURL = (blob) => { blob.text().then((t) => window.__files.push({ type: blob.type, text: t })); return make(blob); };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__lastCalName = this.download; if (!this.download) click.call(this); };
});
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const { ok, done } = checks();
const settle = () => p.waitForFunction(() => !['', 'loading', undefined].includes(document.querySelector('[data-invite]')?.dataset.state), { timeout: 8000 }).catch(() => {});
const visible = (sel) => p.$eval(sel, (e) => !e.hidden && e.getClientRects().length > 0).catch(() => false);

await p.setViewport({ width: 1440, height: 900 });
await p.goto(`${site.base}?c=1`, { waitUntil: 'networkidle0' });
await settle();
ok('the calendar button shows for a circle that is joining', await visible('[data-invite-cal]'));
await p.click('[data-invite-cal]');
await p.waitForFunction(() => window.__files.length > 0, { timeout: 3000 }).catch(() => {});
const [f] = await p.evaluate(() => window.__files);
ok('it offers an iCalendar file', f?.type === 'text/calendar', f?.type);
const ics = f?.text.replace(/\r\n /g, '') ?? '';
ok('one event per round, all three ahead', (ics.match(/BEGIN:VEVENT/g) ?? []).length === 3);
ok('in the page language, naming whose turn each round is', /SUMMARY:Giliran #1: terakhir untuk ikut \(10 USDT\)/.test(ics) && /untuk dodi\.ai/.test(ics), ics.slice(0, 400));
ok('the download is named after the circle', await p.evaluate(() => window.__lastCalName === 'giliran-1.ics'));

await p.goto(`${site.base}?c=2`, { waitUntil: 'networkidle0' });
await settle();
ok('no calendar for a cancelled circle', !(await visible('[data-invite-cal]')));
ok('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
site.close?.();
done();
