// A circle's round deadlines as an iCalendar file with reminders. The same function as calendarIcs in
// skills/giliran/scripts/giliran.mjs (the site and the skill ship separately); a test keeps them identical.
window.GiliranCalendar = function calendarIcs({ circle: n, contract, labels, period, startAt, drawMode, due, link, now, lang = 'en', me = null, paid = [], closedRounds = 0, joinedCount = labels.length }) {
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
