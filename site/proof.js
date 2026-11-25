// The proof page: counters and circles read from the Giliran contract, and a name's payment record.
(() => {
  const C = window.GILIRAN_CONFIG;
  const $ = (s) => document.querySelector(s);
  const T = {
    id: {
      legend: [['paid', 'Sudah bayar putaran ini'], ['due', 'Belum bayar'], ['received', 'Sudah narik']], joinLegend: [['paid', 'Sudah ikut'], ['due', 'Belum ikut']], chip: { paid: 'Sudah bayar', due: 'Belum bayar', joined: 'Sudah ikut', out: 'Belum ikut' }, usdtIn: 'USDT putaran ini', collected: 'USDT terkumpul', newestPaid: (k, n, a, b) => `${k} dari ${n} anggota sudah bayar putaran ini. ${a}\u00a0dari\u00a0${b}\u00a0USDT masuk.`, round: (k) => `Putaran ke-${k}`, newestTitle: (id) => `Arisan terbaru, #${id + 1}`, newestOpen: (r, n) => `Putaran ke-${r} sudah cair. Putaran ke-${r + 1}: belum ada dari ${n} anggota yang bayar.`, newestLine: (k, n, a, b) => `${k} dari ${n} anggota sudah ikut. ${a}\u00a0dari\u00a0${b}\u00a0USDT masuk putaran ini.`, navHow: 'Cara kerja', navSetup: 'Siapkan agen', navFaq: 'Tanya jawab', navProof: 'Bukti', cta: 'Mulai arisan', empty: 'Belum ada transaksi. Begitu anggota bayar, transaksinya muncul di sini.', older: (n) => `${n} pembayaran sejauh ini`, viewAll: 'Lihat di BscScan', footProof: 'Bukti di BNB Chain', menu: 'Menu', open: 'Buka arisannya', ringK: (id) => `Arisan #${id + 1}`, done: 'Selesai', roundsOut: 'putaran cair', finishedLine: (n) => `Arisan ini sudah selesai: ${n} putaran cair.`, joinedOf: (k, n) => `${k} dari ${n} ikut`,
      title: 'Bukti di BNB Chain', lead: 'Setiap angka di sini dibaca langsung dari kontrak, bukan diketik.', back: 'Kembali ke beranda',
      circles: 'Arisan', factory: 'Kontrak Giliran, kode terverifikasi di BscScan', button: 'EN', label: 'Switch to English', locale: 'id-ID',
      stats: [() => 'USDT iuran masuk', () => 'Total yang pernah bayar', () => 'Arisan dibuat', () => 'Pembayaran iuran', () => 'Putaran cair'], contract: 'Kontrak di BscScan', agentId: 'Tentang Binance Agent ID',
      goal: (n) => `${n} dompet Agent ID sudah bayar iuran langsung ke kontrak Giliran.`,
      row: (c) => `${c.joined} dari ${c.size} ikut, ${c.closed} putaran cair${c.cancelled ? ', dibatalkan (iuran dikembalikan)' : ''}`,
      circleName: (id) => `Arisan #${id}`,
      notDeployed: 'Belum dirilis di BNB Chain. Angkanya muncul di sini begitu kontrak dirilis.',
      error: 'Belum bisa membaca BNB Chain. Coba lagi sebentar lagi.',
      recordTitle: 'Cek riwayat bayar sebuah nama .ai', recordLabel: 'Nama .ai', recordGo: 'Cek',
      payments: 'Transaksi terbaru', alltx: 'Semua transaksi di BscScan', code: 'Kode di GitHub',
      risk: 'Nilai USDT bisa berubah dan transaksi di blockchain nggak bisa dibatalkan. Ikut arisan hanya dengan orang yang kamu kenal.',
      ev: { paid: (e) => `Iuran ${e.amount} USDT masuk, arisan #${e.id}, putaran ke-${e.round + 1}`, closed: (e) => `Putaran ke-${e.round + 1} arisan #${e.id} cair, ${e.amount} USDT`, refunded: (e) => `${e.amount} USDT dikembalikan, arisan #${e.id}` },
      noLogs: 'Daftar transaksi belum bisa dibaca dari sini. Semuanya ada di BscScan.',
      noneTitle: 'Belum ada arisan', noneLine: 'Arisan pertama muncul di sini, dibaca langsung dari kontrak, begitu dibuat.', noneGo: 'Mulai arisan',
      newest: (id, k, n) => `Arisan #${id + 1}, yang terbaru: ${k} dari ${n} sudah ikut.`,
      record: (n, r) => (r[0] + r[1] === 0 ? `${n} belum punya riwayat di Giliran.` : `${n} sudah bayar ${r[0]} kali${r[1] ? `, terlewat ${r[1]} kali${r[2] ? ` (${r[2]} setelah narik)` : ''}` : ' dan belum pernah terlewat'}.${r[3] ? ` ${r[3]} arisan selesai tanpa terlewat.` : ''}`),
      badName: 'Tulis nama .ai, misalnya sari.ai.',
    },
    en: {
      legend: [['paid', 'Paid this round'], ['due', 'Not paid yet'], ['received', 'Received a payout']], joinLegend: [['paid', 'Joined'], ['due', 'Not joined yet']], chip: { paid: 'Paid', due: 'Not paid yet', joined: 'Joined', out: 'Not joined yet' }, usdtIn: 'USDT this round', collected: 'USDT collected', newestPaid: (k, n, a, b) => `${k} of ${n} members have paid this round. ${a}\u00a0of\u00a0${b}\u00a0USDT in.`, round: (k) => `Round ${k}`, newestTitle: (id) => `Latest circle, #${id + 1}`, newestOpen: (r, n) => `Round ${r} is paid out. Round ${r + 1}: 0 of ${n} members have paid so far.`, newestLine: (k, n, a, b) => `${k} of ${n} members have joined. ${a}\u00a0of\u00a0${b}\u00a0USDT paid this round.`, navHow: 'How it works', navSetup: 'Agent setup', navFaq: 'Questions', navProof: 'Proof', cta: 'Start a circle', empty: 'No transactions yet. The first payment appears here as soon as a member pays.', older: (n) => `${n} ${n === 1 ? 'payment' : 'payments'} so far`, viewAll: 'View on BscScan', footProof: 'Proof on BNB Chain', menu: 'Menu', open: 'Open this circle', ringK: (id) => `Circle #${id + 1}`, done: 'Finished', roundsOut: 'rounds paid out', finishedLine: (n) => `This circle has finished: ${n} rounds paid out.`, joinedOf: (k, n) => `${k} of ${n} joined`,
      title: 'Proof on BNB Chain', lead: 'Every number here is read from the contract, not typed in.', back: 'Back to home',
      circles: 'Circles', factory: 'Giliran contract, verified code on BscScan', button: 'ID', label: 'Ganti ke Bahasa Indonesia', locale: 'en-US',
      stats: [() => 'USDT paid in', () => 'Payers, all time', (v) => (v === 1 ? 'Circle created' : 'Circles created'), (v) => (v === 1 ? 'Payment' : 'Payments'), () => 'Rounds paid out'], contract: 'Contract on BscScan', agentId: 'About Binance Agent ID',
      goal: (n) => (n === '1' ? '1 Agent ID wallet has paid its dues' : `${n} Agent ID wallets have paid their dues`) + ' straight into the Giliran contract.',
      row: (c) => `${c.joined} of ${c.size} joined, ${c.closed} ${c.closed === 1 ? 'round' : 'rounds'} paid out${c.cancelled ? ', cancelled (dues returned)' : ''}`,
      circleName: (id) => `Circle #${id}`,
      notDeployed: 'Not on BNB Chain yet. The numbers appear here once the contract is deployed.',
      error: 'BNB Chain cannot be read right now. Try again shortly.',
      recordTitle: 'Check a .ai name’s payment record', recordLabel: '.ai name', recordGo: 'Check',
      payments: 'Latest transactions', alltx: 'Every transaction on BscScan', code: 'Code on GitHub',
      risk: 'USDT can change in value and blockchain payments cannot be reversed. Join circles only with people you know.',
      ev: { paid: (e) => `Dues of ${e.amount} USDT paid in, circle #${e.id}, round ${e.round + 1}`, closed: (e) => `Round ${e.round + 1} of circle #${e.id} paid out, ${e.amount} USDT`, refunded: (e) => `${e.amount} USDT returned, circle #${e.id}` },
      noLogs: 'The transaction list cannot be read from here right now. Every transaction is on BscScan.',
      noneTitle: 'No circles yet', noneLine: 'The first circle shows up here, read straight from the contract, the moment it is created.', noneGo: 'Start a circle',
      newest: (id, k, n) => `Circle #${id + 1}, the newest: ${k} of ${n} have joined.`,
      record: (n, r) => { const x = (k) => (k === 1 ? 'once' : k === 2 ? 'twice' : `${k} times`); return r[0] + r[1] === 0 ? `${n} has no record on Giliran yet.` : `${n} has paid ${x(r[0])} and ${r[1] ? `missed ${x(r[1])}${r[2] ? ` (${x(r[2])} after being paid)` : ''}` : 'has never missed a round'}.${r[3] ? ` ${r[3]} ${r[3] === 1 ? 'circle' : 'circles'} finished with no missed round.` : ''}`; },
      badName: 'Type a .ai name, for example sari.ai.',
    },
  };
  const SEL = { stats: '0xd80528ae', info: '0x65f75746', record: '0x4f8456ee', labels: '0xf25fed48', joined: '0xd5ae1e0a', paid: '0x628a55ca', covered: '0x715a708f', recipient: '0x8a948428' };
  const EV = {
    '0x862f86e78e31117319e23bb76bc0f3cfc0358239f7eb12997f9ce3bdc2733616': 'paid', // Paid(id, round, member, payer, amount)
    '0x6079b6dfa9213430f8e4342e17306fbcc675060fba4b9a1fa4df118a2be622d6': 'closed', // Closed(id, round, recipient, paidTo, pot, heldBack)
    '0x7ca5472b7ea78c2c0141c5a12ee6d170cf4ce8ed06be3d22c8252ddfc7a6a2c4': 'refunded', // Refunded(id, payer, amount)
  };
  // English by default; Indonesian for an Indonesian browser. A ?lang= link, then the visitor's own switch, win.
  let lang = (() => {
    const pick = (v) => (v === 'en' || v === 'id' ? v : null);
    let saved = null;
    try { saved = localStorage.getItem('giliran.lang'); } catch {}
    const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    return pick(new URLSearchParams(location.search).get('lang')) || pick(saved) || (langs.some((l) => /^(id|in)\b/i.test(l)) ? 'id' : 'en');
  })();
  let data = null;
  let state = '';
  let record = null;
  let feed = null; // null: not read; false: could not be read; []: read
  let newest = null;

  // The same reader as the invite page (app.js): every endpoint in turn, three rounds with a growing wait, and
  // eth_calls sent as JSON-RPC batches of 20 (one at a time where a node refuses batches).
  const reverted = (x) => /revert/.test(x?.error?.message ?? '');
  const post = async (urls, body, valid) => {
    for (let t = 0; t < 3; t++) {
      for (const url of urls) {
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
          if (!r.ok) continue; // 429 or 5xx: the next endpoint
          const j = await r.json();
          if (valid(j)) return j;
        } catch { /* the next endpoint */ }
      }
      if (t < 2) await new Promise((res) => setTimeout(res, 250 * 4 ** t));
    }
    return null;
  };
  const rpc = async (method, params, urls = C.rpc) => {
    const j = await post(urls, { jsonrpc: '2.0', id: 1, method, params }, (x) => x && (x.result !== undefined || reverted(x)));
    if (!j || reverted(j)) throw new Error(j ? 'reverted' : 'rpc');
    return j.result;
  };
  let batches = true;
  /** eth_calls to the Giliran contract in the order asked; any call that cannot be read fails the whole read. */
  const calls = async (list) => {
    const chunks = [];
    for (let k = 0; k < list.length; k += 20) chunks.push(list.slice(k, k + 20));
    const out = await Promise.all(chunks.map(async (chunk) => {
      if (batches) {
        const body = chunk.map((data, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: C.giliran, data }, 'latest'] }));
        const res = await post(C.rpc, body, (j) => (Array.isArray(j) && j.length === chunk.length && j.every((x) => x.result !== undefined || reverted(x))) || (j && !Array.isArray(j) && j.error));
        if (Array.isArray(res)) {
          const byId = new Map(res.map((x) => [x.id, x]));
          return chunk.map((_, id) => { const x = byId.get(id); if (x.result === undefined) throw new Error('reverted'); return x.result; });
        }
        if (res) batches = false;
      }
      return Promise.all(chunk.map((data) => call(data)));
    }));
    return out.flat();
  };
  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  const W = (hex) => hex.slice(2).match(/.{64}/g).map((w) => BigInt('0x' + w));
  const call = (data) => rpc('eth_call', [{ to: C.giliran, data }, 'latest']);
  const usdt = (wei) => Number(wei / 10n ** 15n) / 1000;
  const strings = (hex) => {
    const h = hex.slice(2);
    const at = (byte) => Number(BigInt('0x' + h.slice(byte * 2, byte * 2 + 64)));
    const base = at(0);
    return [...Array(at(base)).keys()].map((i) => {
      const o = base + 32 + at(base + 32 + i * 32);
      return decodeURIComponent(h.slice((o + 32) * 2, (o + 32 + at(o)) * 2).replace(/../g, '%$&'));
    });
  };
  // One event row. Rows never name a member: a name beside its transaction would show which wallet holds it.
  const event = (log) => {
    const kind = EV[log.topics[0]];
    const id = Number(BigInt(log.topics[1])) + 1; // the circle number people see, as on every other page
    const words = W(log.data);
    if (kind === 'paid') return { kind, id, round: Number(BigInt(log.topics[2])), amount: usdt(words[1]), tx: log.transactionHash };
    if (kind === 'closed') return { kind, id, round: Number(BigInt(log.topics[2])), amount: usdt(words[2]), tx: log.transactionHash };
    return { kind, id, amount: usdt(words[0]), tx: log.transactionHash };
  };
  const encString = (s) => {
    const h = [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return word(0x20) + word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0');
  };

  function draw() {
    const t = T[lang];
    const money = (v) => (Math.round(v * 100) / 100).toLocaleString(t.locale, { maximumFractionDigits: 2 }); // cents, in the page's decimals
    document.documentElement.lang = lang;
    document.title = lang === 'en' ? 'Giliran, proof on BNB Chain' : 'Giliran, bukti di BNB Chain';
    document.querySelectorAll('[data-p]').forEach((el) => { el.textContent = t[el.dataset.p]; });
    const b = $('[data-lang-toggle]');
    b.innerHTML = `<span${lang === 'en' ? ' class="is-on"' : ''}>EN</span><span${lang === 'id' ? ' class="is-on"' : ''}>ID</span>`;
    b.setAttribute('aria-label', t.label);
    $('[data-proof-contract]').href = C.giliran ? `${C.explorer}/address/${C.giliran}#code` : C.explorer;
    $('[data-proof-factory]').href = C.giliran ? `${C.explorer}/address/${C.giliran}#code` : C.explorer;
    const stats = $('[data-proof-stats]');
    const list = $('[data-proof-circles]');
    stats.replaceChildren();
    list.replaceChildren();
    $('[data-proof-note]').textContent = state === 'ok' || state === '' ? t.lead : t[state === 'error' ? 'error' : 'notDeployed'];
    $('[data-proof-goal]').textContent = '';
    if (state === 'ok') {
      const fmt = (n) => Number(n).toLocaleString(t.locale);
      [data.paidIn, data.payers, data.circles.length, data.payments, data.kocokan].forEach((v, i) => {
        const pair = document.createElement('div'); // label first for screen readers; the number shows on top
        pair.append(Object.assign(document.createElement('dt'), { textContent: t.stats[i](Number(v)) }), Object.assign(document.createElement('dd'), { textContent: fmt(v) }));
        stats.append(pair);
      });
      if (Number(data.payers) > 0) $('[data-proof-goal]').textContent = t.goal(fmt(data.payers));
      for (const c of data.circles) {
        const li = document.createElement('li');
        li.append(Object.assign(document.createElement('a'), { href: `./?c=${c.id + 1}`, textContent: t.circleName(c.id + 1) }), Object.assign(document.createElement('span'), { textContent: t.row(c) }));
        list.append(li);
      }
    }
    const pay = $('[data-proof-payments]');
    pay.replaceChildren();
    $('[data-proof-alltx]').href = C.giliran ? `${C.explorer}/address/${C.giliran}` : C.explorer;
    const unlisted = (feed === false || (Array.isArray(feed) && feed.length === 0)) && data && data.payments > 0;
    $('[data-proof-payments-note]').textContent = unlisted ? '' : feed === false ? t.noLogs : Array.isArray(feed) && feed.length === 0 ? t.empty : '';
    // without a list to show, the transactions column steps aside and the ring's caption carries the count
    const none = state === 'ok' && !newest;
    document.querySelector('.proof__feed').hidden = unlisted || none;
    document.querySelector('.proof__live').classList.toggle('is-empty', none);
    document.querySelector('.proof__list').hidden = none; // no circles: no empty list card
    for (const e of feed || []) {
      const li = document.createElement('li');
      li.append(Object.assign(document.createElement('span'), { textContent: t.ev[e.kind]({ ...e, amount: money(e.amount) }) }), Object.assign(document.createElement('a'), { className: 'mono', href: `${C.explorer}/tx/${e.tx}`, textContent: `${e.tx.slice(0, 10)}…` }));
      pay.append(li);
    }
    const ring = $('[data-proof-ring]');
    if (none) {
      const el = (tag, props) => Object.assign(document.createElement(tag), props);
      $('[data-proof-ring-cap]').replaceChildren(
        el('h3', { className: 'proof__cap-title', textContent: t.noneTitle }),
        el('p', { className: 'proof__cap-line', textContent: t.noneLine }),
        el('a', { className: 'btn btn--primary', href: './#mulai', textContent: t.noneGo }),
      );
    }
    if (newest) {
      const legend = document.querySelector('[data-proof-legend]');
      window.GiliranRing.keys(legend, newest.live ? t.legend : newest.finished ? [] : t.joinLegend);
      const k = newest.paid.filter(Boolean).length;
      const n = newest.names.length;
      const due = data && data.circles[0] ? data.circles[0].due : 0;
      const center = newest.finished ? { k: t.done, amount: String(newest.closed), of: `/ ${n}`, unit: t.roundsOut }
        : { k: t.round(newest.live ? newest.closed + 1 : 1), amount: money(k * due), of: `/ ${money(n * due)}`, unit: newest.live ? t.usdtIn : t.collected };
      window.GiliranRing.render(ring, { names: newest.names, paid: newest.finished ? newest.names.map(() => true) : newest.paid, received: newest.names.map((_, i) => newest.received.includes(i)), meter: newest.finished ? 1 : k / n, center }, t.newest(newest.id, k, n));
      if (!newest.replayed) { newest.replayed = true; window.GiliranRing.flow(ring, newest.joined.map((j, k) => (j ? { from: k, to: 'c', at: 300 + k * 350 } : null)).filter(Boolean)); }
      const el = (tag, props) => Object.assign(document.createElement(tag), props);
      const cap = $('[data-proof-ring-cap]');
      cap.replaceChildren(
        el('h3', { className: 'proof__cap-title', textContent: t.newestTitle(newest.id) }),
        el('p', { className: 'proof__cap-line', textContent: newest.finished ? t.finishedLine(n) : newest.live && k === 0 && newest.closed > 0 ? t.newestOpen(newest.closed, n) : (newest.live ? t.newestPaid : t.newestLine)(k, n, k * due, n * due) }),
        el('a', { className: 'btn btn--primary', href: `./?c=${newest.id + 1}`, textContent: t.open }),
      );
      // this round, member by member, next to the ring that draws it
      const list = el('ul', { className: 'invite__members proof__members' });
      newest.names.forEach((nm, i) => {
        const done = newest.live || newest.finished ? newest.paid[i] : newest.joined[i];
        const li = el('li', { className: done ? '' : 'is-waiting' });
        li.append(el('span', { className: 'who', textContent: window.GiliranRing.initials(nm), ariaHidden: 'true' }), el('b', { textContent: nm.replace(/-/g, '\u2011\u200b') }), el('span', { className: 'chip', textContent: newest.live ? (done ? t.chip.paid : t.chip.due) : done ? t.chip.joined : t.chip.out }));
        list.append(li);
      });
      cap.insertBefore(list, cap.querySelector('.btn'));
      if (unlisted) cap.append(el('a', { className: 'proof__cap-link', href: `${C.explorer}/address/${C.giliran}`, textContent: t.viewAll }));
    }
    if (record) {
      const out = $('[data-record-out]');
      out.textContent = record.bad ? t.badName : record.error ? t.error : t.record(record.name, record.r);
      out.classList.toggle('is-error', Boolean(record.bad || record.error));
      if (record.bad) $('#record-name').setAttribute('aria-invalid', 'true'); else $('#record-name').removeAttribute('aria-invalid');
    }
    $('[data-proof]').dataset.state = state;
    // now that the panel is visible, size every ring's labels for the screen
    document.querySelectorAll('svg.ring').forEach((r) => window.GiliranRing.fit(r));
  }

  document.addEventListener('copy', (e) => {
    const sel = String(getSelection() || '');
    if (!/[\u2011\u00a0\u200b]/.test(sel) || !e.clipboardData) return;
    e.clipboardData.setData('text/plain', sel.replace(/\u2011/g, '-').replace(/\u200b/g, '').replace(/\u00a0/g, ' '));
    e.preventDefault();
  });
  const menu = document.querySelector('[data-menu]');
  if (menu) {
    menu.addEventListener('click', () => { const open = document.querySelector('.nav').classList.toggle('is-open'); menu.setAttribute('aria-expanded', String(open)); });
    document.querySelectorAll('.nav__links a').forEach((a) => a.addEventListener('click', () => { document.querySelector('.nav').classList.remove('is-open'); menu.setAttribute('aria-expanded', 'false'); }));
  }
  $('[data-lang-toggle]').addEventListener('click', () => {
    lang = lang === 'en' ? 'id' : 'en';
    try { localStorage.setItem('giliran.lang', lang); } catch {}
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return draw();
    document.documentElement.classList.add('is-switching');
    setTimeout(() => { draw(); requestAnimationFrame(() => document.documentElement.classList.remove('is-switching')); }, 120);
  });

  $('[data-record]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get('name').toString().trim().toLowerCase().replace(/\.ai$/, '');
    if (!/^[a-z0-9-]{1,63}$/.test(name)) record = { bad: true };
    else if (!C.giliran) record = { error: true };
    else {
      try {
        record = { name: `${name}.ai`.replace(/-/g, '\u2011\u200b'), r: W(await call(SEL.record + encString(name))).map(Number) };
      } catch { record = { error: true }; }
    }
    draw();
  });

  (async () => {
    if (!C.giliran) { state = 'empty'; return draw(); }
    try {
      const [circles, payers, payments, paidIn, kocokan] = W(await call(SEL.stats));
      const n = Number(circles);
      const ids = [...Array(Math.min(n, 30)).keys()].map((k) => n - 1 - k); // newest 30
      const infos = n > 0 ? await calls([...ids.map((id) => SEL.info + word(id)), SEL.labels + word(n - 1)]) : [];
      const rows = ids.map((id, k) => {
        const w = W(infos[k]);
        return { id, due: usdt(w[0]), size: Number(w[5]), joined: Number(w[6]), closed: Number(w[7]), cancelled: w[8] === 1n };
      });
      if (n > 0) {
        const id = n - 1;
        const names = strings(infos[ids.length]).map((l) => l + '.ai');
        const info = W(infos[0]); // ids[0] is the newest
        const closed = Number(info[7]);
        // live: every member joined and a round is open, before the start too (round 1 pays out at the last join)
        const live = Number(info[6]) === names.length && info[8] !== 1n && closed < names.length;
        const flag = (x) => W(x)[0] === 1n;
        const ask = [...names.map((_, i) => SEL.joined + word(id) + word(i)), ...[...Array(closed).keys()].map((r) => SEL.recipient + word(id) + word(r))];
        if (live) ask.push(...names.flatMap((_, i) => [SEL.paid + word(id) + word(closed) + word(i), SEL.covered + word(id) + word(closed) + word(i)]));
        const res = await calls(ask);
        const joined = res.slice(0, names.length).map(flag);
        const received = res.slice(names.length, names.length + closed).map((x) => Number(W(x)[0]));
        const open = res.slice(names.length + closed);
        const paid = live ? names.map((_, i) => flag(open[2 * i]) || flag(open[2 * i + 1])) : joined;
        newest = { id, names, joined, paid, live, closed, received, finished: closed >= names.length };
      }
      data = { payers: Number(payers), payments: Number(payments), paidIn: Number(paidIn / 10n ** 15n) / 1000, kocokan: Number(kocokan), circles: rows };
      state = 'ok';
    } catch (e) { console.error('Giliran: could not read the contract', e); state = 'error'; }
    draw();
    if (state !== 'ok') return;
    if (!data.payments) { feed = []; return draw(); } // nothing paid yet: no events to look for
    // Public RPCs cap eth_getLogs (publicnode: 50,000 blocks; bsc-dataseed refuses it), so the list is read
    // newest-first in windows under that cap, four at a time, until 20 rows or 12 windows (~3 days of BSC).
    // Older events are on the BscScan link below the list; an indexer would be needed to list them here.
    try {
      const urls = C.logRpc || C.rpc;
      const hex = (b) => '0x' + b.toString(16);
      const head = Number(BigInt(await rpc('eth_blockNumber', [], urls)));
      const from = C.fromBlock || 0, SPAN = 49000, logs = [];
      for (let hi = head, k = 0; hi >= from && logs.length < 20 && k < 12; k += 4) {
        const wins = [];
        for (let j = 0; j < 4 && hi >= from; j++, hi -= SPAN) wins.push([Math.max(from, hi - SPAN + 1), hi]);
        (await Promise.all(wins.map(([lo, up]) => rpc('eth_getLogs', [{ address: C.giliran, fromBlock: hex(lo), toBlock: hex(up), topics: [Object.keys(EV)] }], urls)))).forEach((l) => logs.push(...l));
      }
      feed = logs.slice().sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) || Number(BigInt(b.logIndex ?? 0) - BigInt(a.logIndex ?? 0))).slice(0, 20).map(event);
    } catch { feed = false; }
    draw();
  })();
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => document.querySelectorAll('svg.ring').forEach((r) => window.GiliranRing.fit(r)), 150); });
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(C.repo)) {
    $('[data-repo-link]').href = C.repo;
    $('[data-repo]').hidden = false;
  }
  draw();
})();
