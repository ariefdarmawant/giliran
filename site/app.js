(() => {
  const C = window.GILIRAN_CONFIG;
  // the contract takes dues from 0.01 to 100 USDT; the site keeps them to whole cents
  const dueValid = (v) => v >= 0.01 && v <= 100 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
  const EN = window.GILIRAN_EN;
  const DYN = window.GILIRAN_DYNAMIC;
  const Ring = window.GiliranRing;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // language: Bahasa Indonesia is in the HTML, English is the switch
  const ID = { title: 'Giliran, arisan yang nggak bisa dibawa kabur' }; // the HTML's own title is the English one, for link previews
  $$('[data-i18n]').forEach((el) => { ID[el.dataset.i18n] = el.textContent; });
  $$('[data-i18n-list]').forEach((el) => { ID[el.dataset.i18nList] = $$('li', el).map((li) => li.textContent); });
  // English by default; Indonesian for an Indonesian browser. A ?lang= link, then the visitor's own switch, win.
  const browserLang = () => ((navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).some((l) => /^(id|in)\b/i.test(l)) ? 'id' : 'en');
  const pick = (v) => (v === 'en' || v === 'id' ? v : null);
  let lang = pick(new URLSearchParams(location.search).get('lang')) || pick(store.get('giliran.lang')) || browserLang();
  const t = (k) => (lang === 'en' ? EN[k] : ID[k]) ?? ID[k] ?? k;
  const d = (k) => DYN[lang][k];

  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t('title');
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-list]').forEach((el) => { $$('li', el).forEach((li, i) => { li.textContent = t(el.dataset.i18nList)[i]; }); });
    const b = $('[data-lang-toggle]');
    b.innerHTML = `<span${lang === 'en' ? ' class="is-on"' : ''}>EN</span><span${lang === 'id' ? ' class="is-on"' : ''}>ID</span>`;
    b.setAttribute('aria-label', d('langLabel'));
    composer.sync();
    invite.draw();
    money.draw();
    $('[data-share-num]').placeholder = d('shareHint');
    $('[data-share-num]').dispatchEvent(new Event('input'));
    rupiah.paint();
  }
  // a question opens and closes with an eased height (and its answer fades), in every browser
  $$('.qa__item').forEach((item) => {
    const sum = $('summary', item);
    sum.addEventListener('click', (e) => {
      if (reduced || !item.animate) return;
      e.preventDefault();
      const opening = !item.open;
      const from = item.offsetHeight;
      if (opening) item.open = true;
      const to = opening ? item.scrollHeight : sum.offsetHeight;
      item.style.overflow = 'hidden';
      item.classList.toggle('is-closing', !opening);
      const a = item.animate({ height: [`${from}px`, `${to}px`] }, { duration: 380, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' });
      if (opening) [...item.children].filter((c) => c !== sum).forEach((c) => c.animate({ opacity: [0, 1] }, { duration: 380, easing: 'cubic-bezier(0.55, 0, 0.75, 0.2)' }));
      a.onfinish = () => { if (!opening) item.open = false; item.style.overflow = ''; item.classList.remove('is-closing'); };
    });
  });
  // in-page links to the presentation land on its first pinned frame, not on its approach
  $$('a[href="#cara"]').forEach((a) => a.addEventListener('click', (e) => {
    const t = $('.money__track');
    if (!t) return;
    e.preventDefault();
    scrollTo({ top: t.getBoundingClientRect().top + scrollY - ($('.nav')?.offsetHeight || 0), behavior: reduced ? 'auto' : 'smooth' });
    history.replaceState(null, '', '#cara');
  }));
  document.addEventListener('copy', (e) => {
    const sel = String(getSelection() || '');
    if (!/[\u2011\u00a0\u200b]/.test(sel) || !e.clipboardData) return;
    e.clipboardData.setData('text/plain', sel.replace(/\u2011/g, '-').replace(/\u200b/g, '').replace(/\u00a0/g, ' '));
    e.preventDefault();
  });
  const menu = $('[data-menu]');
  if (menu) {
    menu.addEventListener('click', () => { const open = $('.nav').classList.toggle('is-open'); menu.setAttribute('aria-expanded', String(open)); });
    $$('.nav__links a').forEach((a) => a.addEventListener('click', () => { $('.nav').classList.remove('is-open'); menu.setAttribute('aria-expanded', 'false'); }));
  }
  $('[data-lang-toggle]').addEventListener('click', () => {
    lang = lang === 'en' ? 'id' : 'en';
    store.set('giliran.lang', lang);
    const u = new URL(location.href);
    u.searchParams.set('lang', lang);
    history.replaceState(null, '', u);
    // keep the element you are looking at where it is, even when the new language wraps differently
    const anchor = scrollY < 10 ? null : document.elementFromPoint(innerWidth / 2, innerHeight / 3)?.closest('h1, h2, h3, p, li, form, figure, section');
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    const swap = () => {
      applyLang();
      if (anchor) { const dy = anchor.getBoundingClientRect().top - before; if (Math.abs(dy) > 1) scrollTo({ top: scrollY + dy, behavior: 'instant' }); }
    };
    if (reduced || !document.startViewTransition) return swap();
    document.startViewTransition(swap);
  });

  // rupiah: an estimate next to USDT amounts, hidden when no rate is available
  const rupiah = {
    rate: (() => { try { const c = JSON.parse(localStorage.getItem('giliran.idr') || 'null'); return c && Date.now() - c.t < 6 * 3600e3 ? Number(c.v) || 0 : 0; } catch { return 0; } })(),
    fmt(usdt) { return d('rupiah')(usdt * this.rate); },
    paint() { if (this.rate) $$('[data-idr]').forEach((el) => { el.textContent = this.fmt(Number(el.dataset.idr)); }); },
    async load() {
      if (this.rate) return this.paint();
      // USDT tracks the dollar, so the USD rate is a fair estimate (the page says "±").
      const sources = [
        ['https://open.er-api.com/v6/latest/USD', (j) => j?.rates?.IDR],
        ['https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr', (j) => j?.tether?.idr],
      ];
      for (const [url, pick] of sources) {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) continue;
          const v = pick(await r.json());
          if (v > 1000) {
            this.rate = v;
            try { localStorage.setItem('giliran.idr', JSON.stringify({ v, t: Date.now() })); } catch {}
            this.paint();
            composer.sync();
            return;
          }
        } catch { /* next source; with none, the estimate stays hidden */ }
      }
    },
  };

  const SAMPLE = ['rina.ai', 'dodi.ai', 'sari.ai', 'fajar.ai', 'mega.ai'];

  // where the money goes: one pinned stage; the scroll through it drives the example circle's money
  // p runs 0..3 while the stage is pinned. Beat 0 (dues come in, one wallet at a time), beat 1 (the contract holds the
  // pot), beat 2 (the line draws to sari.ai and the pot drains to her). One caption is fully visible at a time, and
  // the ring shows exactly that caption's state; every frame sets the whole state, so a jump never leaves it stale.
  const money = {
    track: $('.money__track'),
    stage: $('[data-money-stage]'),
    ring: $('[data-money-ring]'),
    stops: $$('.money__stops > li'),
    p: NaN,
    paid: -1,
    drawn: null,
    draw() {
      if (!this.ring) return;
      const base = Ring.svg({ names: SAMPLE, paid: SAMPLE.map(() => false), received: [true, true, false, false, false], meter: 0 });
      const c = d('stageC');
      const t = (cls, y, txt, attr = '') => `<text class="${cls}" x="300" y="${y}" text-anchor="middle"${attr}>${txt}</text>`;
      const amount = (attr, of) => `<text class="ring__amount" x="300" y="326" text-anchor="middle"><tspan ${attr}>0</tspan><tspan class="ring__of" dx="6">${of}</tspan></text>`;
      this.ring.innerHTML = base
        + `<g class="money-c" data-for="0">${t('ring__k', 232, d('drawNo')(3))}${amount('data-amount', '/ 50')}${t('ring__unit', 372, '', ' data-paid-of')}</g>`
        + `<g class="money-c" data-for="1">${t('ring__k', 232, c.held)}<text class="ring__amount" x="300" y="326" text-anchor="middle">50<tspan class="ring__of" dx="6">USDT</tspan></text>${t('ring__unit', 372, c.noOwner)}</g>`
        + `<g class="money-c" data-for="2">${t('ring__k', 232, d('drawNo')(3), ' data-out-top')}${amount('data-out', 'USDT')}${t('ring__when', 372, '', ' data-out-w')}</g>`;
      this.ring.insertAdjacentHTML('afterbegin', '<circle class="ring__seal" cx="300" cy="300" r="172" pathLength="1" transform="rotate(-90 300 300)"/>');
      this.seal = $('.ring__seal', this.ring);
      this.phone = matchMedia('(max-width: 60rem)').matches;
      this.ring.setAttribute('viewBox', this.phone ? '56 56 488 488' : '-70 0 740 600');
      this.meter = $('.ring__meter', this.ring);
      this.pointer = $('.ring__pointer', this.ring);
      this.nodes = $$('.node', this.ring);
      this.centers = $$('.money-c', this.ring);
      this.paid = -1;
      this.drawn = null;
      const p = Number.isNaN(this.p) ? 0 : this.p;
      this.p = NaN;
      this.set(p, false);
      Ring.keys($('[data-money-key]'), d('invite').moneyKey);
      Ring.fit(this.ring);
      this.ring.addEventListener('animationend', () => Ring.fit(this.ring), { once: true });
    },
    progress() {
      const r = this.track.getBoundingClientRect();
      const top = $('.nav') ? $('.nav').offsetHeight : 0;
      const run = this.track.offsetHeight - (innerHeight - top);
      return run > 0 ? Math.max(0, Math.min(3, ((top - r.top) / run) * 3)) : 0;
    },
    set(p, animate = true) {
      if (!this.ring) return;
      const was = this.p;
      this.p = p;
      const clamp = (v) => Math.max(0, Math.min(1, v));
      const step = Math.min(2, Math.floor(p));
      this.stage.dataset.step = String(step);
      // beat 0: one wallet after another pays in; the number and the arc move together
      const paid = p < 0.05 ? 0 : Math.min(5, Math.floor((p - 0.05) / 0.15) + 1);
      if (paid !== this.paid) {
        if (animate && paid > this.paid && this.paid >= 0) Ring.flow(this.ring, [...Array(paid - this.paid).keys()].map((k) => ({ from: this.paid + k, to: 'c', at: k * 90 })));
        this.nodes.forEach((n, i) => { n.classList.toggle('node--paid', i < paid); n.classList.toggle('node--due', i >= paid); });
        $('[data-amount]', this.ring).textContent = String(paid * 10);
        $('[data-paid-of]', this.ring).textContent = d('stageC').paidOf(paid, 5);
        this.paid = paid;
      }
      // beat 2: the line to sari.ai draws, then the pot drains out to her
      this.nodes[2].classList.toggle('node--next', step === 2); // the person this beat is about keeps their name, even where the others are hidden
      const drawn = p >= 2.6;
      if (drawn !== this.drawn) {
        if (animate && drawn && was < p) Ring.flow(this.ring, [{ from: 'c', to: 2, at: 0 }]);
        this.nodes[2].classList.toggle('node--drawn', drawn);
        this.drawn = drawn;
      }
      const drain = clamp((p - 2.3) / 0.35);
      const fill = (paid / 5) * (1 - drain); // the whole pot leaves for sari.ai
      // while it pays, the remaining pot is an arc that ends at sari.ai's dot (2/5 round the ring) and shrinks into it
      const len = fill * 100;
      const end = drain > 0 ? 40 + len / 2 : len; // centred on sari.ai's dot while it drains
      this.meter.setAttribute('stroke-dasharray', `${len.toFixed(1)} ${(100 - len).toFixed(1)}`);
      this.meter.style.strokeDashoffset = String(-(end - len));
      this.meter.style.opacity = fill > 0.001 ? '1' : '0';
      this.meter.style.strokeLinecap = (drain > 0 && drain < 1) || fill < 0.05 ? 'butt' : 'round'; // an empty arc would still draw a dot from its round cap
      const c = d('stageC');
      $('[data-out]', this.ring).textContent = '50';
      $('[data-out-top]', this.ring).textContent = d('drawNo')(3);
      const w = $('[data-out-w]', this.ring);
      const label = (drain <= 0 ? c.ready : drain < 1 ? c.paying : c.paidTo)('sari.ai');
      if (w.textContent !== label) { w.textContent = label; Ring.fit(this.ring); }
      this.centers.forEach((c, i) => c.classList.toggle('is-on', i === step));
      this.nodes[2].classList.toggle('is-target', step === 2 && !drawn);
      // beat 1: a line closes around the pot, the contract sealing it; it opens again as the pot pays out
      const close = clamp((p - 1.05) / 0.6);
      this.seal.style.strokeDashoffset = String(1 - close);
      this.ring.classList.toggle('is-locked', step === 1 && close > 0.2);
      this.seal.classList.toggle('is-closed', p >= 1.65 && p < 2.05);
      this.seal.style.opacity = String(Math.min(close, 1 - clamp((p - 2.36) / 0.08)));
      // captions: the current one fully visible; a short cross-fade only at each boundary
      this.stops.forEach((el, i) => {
        el.classList.toggle('is-on', i === step);
        el.classList.toggle('is-past', i < step);
      });
    },
  };
  let ticking = false;
  const pickBeat = () => {
    ticking = false;
    const mid = innerHeight / 2;
    if (money.track) money.set(money.progress());
    // marks the nav once the hero has scrolled away (phones keep the start button in the menu sheet)
    const heroEl = $('.hero');
    if (heroEl && $('.nav')) $('.nav').classList.toggle('is-past-hero', heroEl.getBoundingClientRect().bottom < $('.nav').offsetHeight || document.body.classList.contains('is-invite'));
    // the nav turns dark while the dark presentation is under it
    const sec = $('.money');
    const nav = $('.nav');
    if (sec && nav) { const r = sec.getBoundingClientRect(); nav.classList.toggle('is-dark', r.top <= nav.offsetHeight && r.bottom > nav.offsetHeight + 1); }
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(pickBeat); } }, { passive: true });

  // composer: the form writes your circle and the sentence for your agent
  const form = $('[data-composer]');
  const composer = {
    names() {
      const seen = new Set();
      const valid = [];
      const invalid = [];
      const dups = [];
      for (const part of String(new FormData(form).get('members') || '').split(/[,\n]+/)) {
        const s = part.trim().toLowerCase().replace(/\.ai$/, '');
        if (!s) continue;
        if (!/^[a-z0-9-]{1,63}$/.test(s)) invalid.push(part.trim());
        else if (!seen.has(s)) { seen.add(s); valid.push(s + '.ai'); } else if (!dups.includes(s + '.ai')) dups.push(s + '.ai');
      }
      return { valid, invalid, dups };
    },
    sync() {
      const f = new FormData(form);
      const { valid: names, invalid, dups } = this.names();
      const due = Number(f.get('due'));
      const every = String(f.get('every'));
      const draw = f.get('order') === 'draw';
      const n = names.length;
      const say = $('[data-say]');
      const btn = $('[data-copy]');
      const result = $('[data-result]');
      const preview = $('[data-composer-ring]');
      const fieldError = (input, out, msg) => {
        $(out).textContent = msg;
        if (msg) $(input).setAttribute('aria-invalid', 'true'); else $(input).removeAttribute('aria-invalid');
      };
      fieldError('#f-due', '[data-due-error]', '');
      fieldError('#f-members', '[data-members-error]', '');
      const dueOk = dueValid(due);
      // with 3 members, holding back 2 payments is the same as Full
      $('[data-due-hint]').textContent = dueOk ? d('dueHint')(due, rupiah.rate ? rupiah.fmt(due) : '') : '';
      // an empty or invalid form shows the example circle, dimmed, and offers nothing to copy
      const stop = (input, out, msg) => {
        if (input) $('[data-due-hint]').textContent = '';
        if (input && out) fieldError(input, out, msg);
        result.classList.toggle('is-example', !input);
        btn.disabled = true;
        result.classList.toggle('is-invalid', Boolean(input));
        btn.textContent = !input ? d('typeMembers') : (n < 3 && !invalid.length && !dups.length && dueValid(due)) ? d('needNames') : d('fixAbove');
        const exDue = dueValid(due) ? due : 10;
        const show = names.length ? names : SAMPLE; // what was typed, or the example while nothing is
        // empty: a dimmed, labelled example of the sentence. With an error: no sentence and no amount, never an old one.
        say.textContent = input ? '' : d('sentence')({ site: C.site, names: show.join(', '), due: exDue, every, draw });
        say.classList.toggle('is-example', !input);
        const ex = input && names.length ? names : SAMPLE;
        // the example is a round in progress (3 of 5 paid); typed names that are not a valid circle yet show faded, unpaid
        const base = input && this.last ? this.last : input ? { names: ex, paid: ex.map(() => false), meter: 0, center: {} }
          : { names: ex, paid: ex.map((_, k) => k < 3), meter: 3 / ex.length, center: { ...d('previewCenter')(exDue * ex.length), unit: d('membersCount')(ex.length) } };
        if (preview) { Ring.render(preview, base, d('summary')(show.length, 0, '')); preview.classList.toggle('is-blank', Boolean(input) && !this.last && !names.length); }
        if (input) { say.textContent = d('sayLater'); say.classList.add('is-example'); }
      };
      // every field says what is wrong with it, all at once
      const dueBad = !dueValid(due);
      const namesBad = invalid.length ? d('badNames')(invalid.join(', ')) : dups.length ? d('dupNames')(dups.join(', ')) : n > 0 && (n < 3 || n > 25) ? d('badCount')(n) : '';
      if (dueBad) fieldError('#f-due', '[data-due-error]', d('badDue'));
      if (namesBad) fieldError('#f-members', '[data-members-error]', namesBad);
      if (dueBad || namesBad) return stop(dueBad && !namesBad && n >= 3 ? '#f-due' : '#f-members', null, null);
      if (n === 0) return stop();
      btn.disabled = false;
      btn.textContent = t('s.copy');
      result.classList.remove('is-invalid', 'is-example');
      say.classList.remove('is-example');
      const pot = due * n;
      say.textContent = d('sentence')({ site: C.site, names: names.join(', '), due, every, draw }).replace(/-/g, '\u2011\u200b') + (C.skill ? d('skillLine')(C.skill) : '');
      this.last = { names, paid: names.map(() => false), meter: 0, center: { ...d('previewCenter')(pot), unit: d('membersCount')(n) } };
      if (preview) { Ring.render(preview, this.last, d('summary')(n, pot, '')); preview.classList.remove('is-blank'); }
      rupiah.paint();
    },
  };
  form.addEventListener('input', () => composer.sync());
  // after the agent creates the circle it gives its number; the organizer sends the invite link to the group
  $('[data-share-num]').addEventListener('input', (e) => {
    const raw = e.target.value;
    const n = raw.replace(/\D/g, '');
    const a = $('[data-share-wa]');
    const phone = /^\+|^0\d{3,}|\s/.test(raw.trim()) || n.length > 6; // looks like a phone number, not a circle number
    const bad = phone || /^0/.test(n);
    $('[data-share-error]').textContent = phone ? d('sharePhone') : bad ? d('shareZero') : '';
    e.target.toggleAttribute('aria-invalid', bad);
    const ready = !bad && /^[1-9]\d{0,5}$/.test(n);
    if (ready) {
      a.href = `https://wa.me/?text=${encodeURIComponent(d('invite').share(`https://${C.site}/?c=${n}&lang=${lang}`))}`;
      a.removeAttribute('aria-disabled');
      a.classList.add('is-ready', 'btn--primary');
    } else {
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
      a.classList.remove('is-ready', 'btn--primary');
    }
    shareNext(ready ? n : null);
  });
  // with the circle number, the organizer can open its page and is reminded that they join by paying too
  function shareNext(n) {
    const next = $('[data-share-next]');
    next.hidden = !n;
    if (!n) return;
    $('[data-share-open]').href = `./?c=${n}&lang=${lang}`;
    $('[data-share-open]').textContent = d('shareOpen')(n);
    $('[data-share-join]').textContent = d('shareJoin')(n);
  }
  form.addEventListener('change', () => composer.sync());
  const gcmd = $('[data-giliran-cmd]');
  // until the Giliran skill is published, its step says so instead of showing an empty command
  if (gcmd && C.skill) { $('code', gcmd).textContent = C.skill; gcmd.hidden = false; }
  $('[data-giliran-soon]').hidden = Boolean(C.skill);
  $$('[data-copy-cmd]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.previousElementSibling.textContent.trim()); b.textContent = d('copied'); }
    catch { b.textContent = d('copyByHand'); }
    setTimeout(() => { b.textContent = t('a.copy'); }, 1600);
  }));
  $('[data-copy]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try {
      await navigator.clipboard.writeText($('[data-say]').textContent.trim().replace(/\u2011/g, '-').replace(/\u200b/g, '').replace(/\u00a0/g, ' '));
      b.textContent = d('copied');
    } catch {
      b.textContent = d('copyByHand');
    }
    setTimeout(() => { b.textContent = t('s.copy'); }, 1800);
  });

  // chain: read straight from BNB Chain over public RPC
  // Like the skill helper's post(): every endpoint in turn, three rounds, waiting 250 ms then 1 s between rounds.
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
  const rpc = async (method, params) => {
    const j = await post(C.rpc, { jsonrpc: '2.0', id: 1, method, params }, (x) => x && (x.result !== undefined || reverted(x)));
    if (!j || reverted(j)) throw new Error(j ? 'reverted' : 'rpc');
    return j.result;
  };
  let batches = true; // false once a node refuses a JSON-RPC batch: one call at a time from then on
  /** eth_calls to the Giliran contract, as JSON-RPC batches of 20, results in the order asked; null where a call reverts. */
  const calls = async (list) => {
    const one = (data) => rpc('eth_call', [{ to: C.giliran, data }, 'latest']).catch((e) => { if (e.message === 'reverted') return null; throw e; });
    const chunks = [];
    for (let k = 0; k < list.length; k += 20) chunks.push(list.slice(k, k + 20));
    const out = await Promise.all(chunks.map(async (chunk) => {
      if (batches) {
        const body = chunk.map((data, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: C.giliran, data }, 'latest'] }));
        // a node that refuses batches answers with one error object: settle for that at once, not after three rounds
        const res = await post(C.rpc, body, (j) => (Array.isArray(j) && j.length === chunk.length && j.every((x) => x.result !== undefined || reverted(x))) || (j && !Array.isArray(j) && j.error));
        if (Array.isArray(res)) { const byId = new Map(res.map((x) => [x.id, x])); return chunk.map((_, id) => byId.get(id).result ?? null); }
        if (res) batches = false;
      }
      return Promise.all(chunk.map(one));
    }));
    return out.flat();
  };
  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  const W = (hex) => hex.slice(2).match(/.{64}/g).map((w) => BigInt('0x' + w));
  const u = (hex) => BigInt('0x' + (hex.slice(2, 66) || '0'));
  const strings = (hex) => {
    const h = hex.slice(2);
    const at = (byte) => Number(BigInt('0x' + h.slice(byte * 2, byte * 2 + 64)));
    const base = at(0);
    const n = at(base);
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = base + 32 + at(base + 32 + i * 32);
      const len = at(o);
      out.push(decodeURIComponent(h.slice((o + 32) * 2, (o + 32 + len) * 2).replace(/../g, '%$&')));
    }
    return out;
  };
  const encString = (s) => { const h = [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join(''); return word(32) + word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0'); };
  const S = { count: '0xcf0b1117', info: '0x65f75746', labels: '0xf25fed48', joined: '0xd5ae1e0a', paid: '0x628a55ca', covered: '0x715a708f', paidCount: '0xc4f1cc06', recipient: '0x8a948428', payout: '0xa19b6ff6', drawBlock: '0x8428574e', record: '0x4f8456ee' };
  const sel = (s, ...args) => s + args.map(word).join('');

  /** One circle read from the contract: its terms, who joined, every closed round's payout, the open round's payments. */
  async function readCircle(id) {
    const [info, names] = await calls([sel(S.info, id), sel(S.labels, id)]);
    if (!info || !names) throw new Error('no circle');
    const [contribution, period, startAt, drawMode, guaranteeDues, size, joinedCount, closedRounds, cancelled] = W(info);
    const c = { contribution, period: Number(period), startAt: Number(startAt), drawMode: drawMode === 1n, guaranteeDues: Number(guaranteeDues), size: Number(size), joinedCount: Number(joinedCount), closed: Number(closedRounds), cancelled: cancelled === 1n, labels: strings(names) };
    const n = c.size, r = c.closed;
    const going = c.joinedCount === n && !c.cancelled && r < n; // the contract's own `active`, with a round still open
    // every read in one list, sent as batches; each part remembers where its answers sit
    const ask = [];
    const at = (data) => ask.push(data) - 1;
    const joined = c.labels.map((_, i) => at(sel(S.joined, id, i)));
    const rounds = [...Array(r).keys()].map((k) => [at(sel(S.recipient, id, k)), at(sel(S.payout, id, k))]);
    const paid = going ? c.labels.map((_, i) => [at(sel(S.paid, id, r, i)), at(sel(S.covered, id, r, i))]) : [];
    const count = going ? at(sel(S.paidCount, id, r)) : -1;
    const draw = going && c.drawMode && r + 1 < n ? at(sel(S.drawBlock, id, r)) : -1; // the last round has no draw
    const records = c.labels.map((l) => at(S.record + encString(l)));
    const res = await calls(ask);
    const need = (k) => { if (res[k] == null) throw new Error('unreadable'); return res[k]; }; // a record that can't be read is just left out; the rest must be there
    const flag = (k) => u(need(k)) === 1n;
    const drawBlock = draw >= 0 ? Number(u(need(draw))) : 0;
    let drawReady = false;
    if (drawBlock) { try { drawReady = Number(BigInt(await rpc('eth_blockNumber', []))) > drawBlock; } catch { drawReady = true; } } // three blocks is about a second
    return {
      ...c,
      due: Number(c.contribution / 10n ** 15n) / 1000,
      joined: joined.map(flag),
      rounds: rounds.map(([who, got]) => ({ who: Number(u(need(who))), got: Number(u(need(got)) / 10n ** 15n) / 1000 })),
      paidNow: paid.map(([p, cv]) => flag(p) || flag(cv)),
      byGuarantee: paid.map(([p, cv]) => !flag(p) && flag(cv)),
      paidCount: count >= 0 ? Number(u(need(count))) : 0,
      drawBlock,
      drawReady,
      records: records.map((k) => (res[k] ? W(res[k]).map(Number) : null)),
    };
  }

  // invitation: ?c=<circle number> is its own page: the circle read from chain, your seat, the next step
  // States: loading, unknown, error; joining (before the start), full (everyone joined, the next round not open yet),
  // running (a round collecting), open (a round that is due: anyone can open its kocokan), unfilled (the start
  // passed without everyone: anyone can cancel), cancelled, finished.
  const invite = {
    el: $('[data-invite]'),
    addr: new URLSearchParams(location.search).get('c'),
    data: null,
    state: '',
    slow: false,
    async load() {
      if (this.addr === null || !this.el) return;
      this.el.hidden = false;
      document.body.classList.add('is-invite');
      $('.nav')?.classList.add('is-past-hero');
      $$('.nav a[href^="#"]').forEach((a) => a.setAttribute('href', './' + a.getAttribute('href')));
      this.state = 'loading';
      this.data = null;
      this.slow = false;
      clearTimeout(this.slowTimer);
      this.slowTimer = setTimeout(() => { if (this.state === 'loading') { this.slow = true; this.draw(); } }, 4000);
      this.draw();
      // the link carries the circle number people see (from 1); the contract's id is one less
      if (!/^\d{1,9}$/.test(this.addr) || this.addr === '0' || /^0/.test(this.addr)) this.state = 'unknown';
      else if (!C.giliran) this.state = 'error';
      else {
        try {
          const count = u(await rpc('eth_call', [{ to: C.giliran, data: S.count }, 'latest']));
          if (BigInt(this.addr) - 1n >= count) this.state = 'unknown';
          else {
            const x = await readCircle(BigInt(this.addr) - 1n);
            const now = Date.now() / 1000;
            const full = x.joinedCount === x.size;
            // the contract's _due: everyone has paid the open round (a guarantee counts), or its deadline has passed;
            // a scheduled draw is due by definition
            const due = full && (x.paidCount === x.size || now >= x.startAt + x.closed * x.period || x.drawBlock > 0);
            this.data = x;
            this.state = x.cancelled ? 'cancelled' : x.closed >= x.size ? 'finished' : !full ? (now >= x.startAt ? 'unfilled' : 'joining') : due ? 'open' : now >= x.startAt ? 'running' : 'full';
          }
        } catch { this.state = 'error'; }
      }
      clearTimeout(this.slowTimer);
      this.draw();
    },
    /** The circle's deadlines still ahead as an .ics file, or null when there is nothing to remind. */
    ics() {
      const x = this.data;
      if (!x || !window.GiliranCalendar || !['joining', 'full', 'running', 'open'].includes(this.state)) return null;
      return window.GiliranCalendar({
        circle: Number(this.addr), contract: C.giliran, labels: x.labels, period: x.period, startAt: x.startAt, drawMode: x.drawMode,
        due: `${d('usd')(x.due)} USDT`, link: `https://${C.site}/?c=${this.addr}&lang=${lang}`, now: Math.floor(Date.now() / 1000), lang, closedRounds: x.closed, joinedCount: x.joinedCount,
      });
    },
    draw() {
      if (!this.state) return;
      const i = d('invite');
      const x = this.data;
      const state = this.state;
      const el = (tag, props) => Object.assign(document.createElement(tag), props);
      const title = i.title[state];
      $('[data-invite-title]').textContent = typeof title === 'function' ? title(this.addr) : title ?? i.titleOf(this.addr);
      const terms = $('[data-invite-terms]');
      const list = $('[data-invite-members]');
      terms.replaceChildren();
      list.replaceChildren();
      $('[data-invite-joined]').textContent = '';
      $('[data-invite-total]').textContent = '';
      const ring = $('[data-invite-ring]');
      ring.replaceChildren();
      let note = i.note[state];
      let owed = false; // somebody has not paid the open round
      if (x) {
        const n = x.labels.length;
        const names = x.labels.map((l) => l + '.ai');
        const now = Date.now() / 1000;
        const at = (sec, opts) => new Date(sec * 1000).toLocaleString(d('locale'), opts);
        const rel = (sec) => {
          const days = (sec - now) / 86400, a = Math.abs(days), f = new Intl.RelativeTimeFormat(d('locale'), { numeric: 'auto' });
          return a < 0.75 ? f.format(Math.round(days * 24), 'hour') : a < 45 ? f.format(Math.round(days), 'day') : a < 548 ? f.format(Math.round(days / 30), 'month') : f.format(Math.round(days / 365), 'year');
        };
        const long = (sec) => at(sec, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
        const r = x.closed; // the open round, counted from 0
        const deadline = x.startAt + r * x.period;
        const paidRound = x.paidNow.filter(Boolean).length;
        owed = state === 'open' && paidRound < n;
        const before = state === 'joining' || state === 'full';
        const collecting = state === 'running' || state === 'open';
        const recipient = (k) => { const g = x.rounds[k]; return g ? names[g.who] : null; };
        // the date row: when to join, when round 2 opens, this round's deadline; none once nothing is ahead
        let row = null;
        if (state === 'joining') row = [i.terms[5], i.when(long(x.startAt), rel(x.startAt))];
        else if (state === 'full') row = [i.opensLabel(r + 1), i.when(long(x.startAt), rel(x.startAt))];
        else if (state === 'running') row = [i.nextLabel, i.payBy(r + 1, long(deadline).replace(/ /g, ' '), rel(deadline))];
        else if (state === 'open') row = [i.nextLabel, x.drawBlock ? i.openRow.drawn(r + 1) : paidRound === n ? i.openRow.paid(r + 1) : i.openRow.overdue(r + 1, rel(deadline))];
        const rows = [[i.terms[1], `${d('usd')(x.due)} USDT`], [i.terms[2], i.every(x.period)], [i.terms[3], i.order(x.drawMode)], x.guaranteeDues ? [i.terms[4], i.guarantee(x.guaranteeDues, n)] : null, row];
        rows.forEach((pair, k) => {
          if (!pair) return;
          const dd = el('dd', { textContent: pair[1] });
          if (k === 0) { dd.append(' ', el('span', { className: 'idr' })); dd.lastChild.dataset.idr = String(x.due); }
          terms.append(el('dt', { textContent: pair[0] }), dd);
        });
        // the ring: who joined (before), who paid the open round (running, open), round 1's payout (full); no
        // centre figure once nothing is collecting
        const received = names.map((_, k) => x.rounds.some((g) => g.who === k));
        const joinedK = x.joined.filter(Boolean).length;
        const center = state === 'joining' ? { k: d('drawNo')(1), amount: d('usd')(joinedK * x.due), of: `/ ${d('usd')(n * x.due)}`, unit: i.usdtIn }
          : state === 'full' ? { k: d('drawNo')(1), amount: String(x.rounds[0]?.got ?? 0), of: 'USDT', unit: i.receivedBy(recipient(0)) }
            : collecting ? { k: d('drawNo')(r + 1), amount: d('usd')(paidRound * x.due), of: `/ ${d('usd')(n * x.due)}`, unit: i.thisRound } : {};
        const dots = collecting ? x.paidNow : state === 'finished' ? names.map(() => true) : x.joined;
        Ring.render(ring, { names, paid: dots, received, meter: collecting ? paidRound / n : state === 'joining' ? joinedK / n : state === 'finished' || state === 'full' ? 1 : 0, center });
        ring.removeAttribute('aria-label');
        Ring.keys($('[data-invite-legend]'), collecting ? i.legend : state === 'joining' || state === 'unfilled' ? i.joinLegend : []);
        if (!this.replayed) { this.replayed = true; Ring.flow(ring, x.joined.map((j, k) => (j ? { from: k, to: 'c', at: 300 + k * 350 } : null)).filter(Boolean)); }
        names.forEach((name, k) => {
          const li = el('li', { className: (before || state === 'unfilled') && !x.joined[k] ? 'is-waiting' : '' });
          li.append(el('span', { className: 'who', textContent: Ring.initials(name), ariaHidden: 'true' }), el('b', { textContent: name.replace(/-/g, '‑​') }));
          if (before || state === 'unfilled') li.append(el('span', { className: 'chip', textContent: i.status(x.joined[k]) }));
          else if (collecting) {
            li.className = x.paidNow[k] ? '' : 'is-waiting';
            li.append(el('span', { className: 'chip', textContent: x.byGuarantee[k] ? i.byGuarantee : x.paidNow[k] ? i.paidRound : i.notPaid }));
          }
          const got = x.rounds.findIndex((g) => g.who === k);
          if (got >= 0) {
            const g = x.rounds[got];
            li.append(el('small', { textContent: i.gotTurn(got + 1, g.got, x.guaranteeDues > 0 && got + 1 < n) }));
          } else if (!x.drawMode && !['unfilled', 'cancelled', 'finished'].includes(state)) {
            // fixed order: member k receives round k, at its deadline at the latest (round 1: once everyone has joined)
            li.append(el('small', { textContent: k === 0 ? i.turnFirst : k === r && state === 'open' ? i.turnReady(k + 1) : i.turnOf(k + 1, at(x.startAt + k * x.period, { day: 'numeric', month: 'short' }).replace(/ /g, ' ')) }));
          }
          if (x.records?.[k]) li.append(el('small', { className: 'invite__rec', textContent: i.record(x.records[k]) }));
          list.append(li);
        });
        if (before || state === 'unfilled') $('[data-invite-joined]').textContent = i.joined(joinedK, n);
        if (state === 'joining') $('[data-invite-total]').textContent = i.total(n, x.due, x.guaranteeDues);
        // the note says what the chain is waiting for, and who can move it
        const who = x.drawMode ? null : names[r];
        if (state === 'full') note = i.full(recipient(0), x.rounds[0]?.got ?? 0, long(x.startAt));
        else if (state === 'open') note = x.drawBlock ? i.open.drawn(r + 1, x.drawReady) : paidRound === n ? i.open.paid(r + 1, who) : i.open.overdue(r + 1, who);
      }
      if (state === 'loading' && this.slow) note = i.note.slow;
      const canSay = ['joining', 'running', 'open', 'unfilled'].includes(state);
      $('.invite__act-title').textContent = state === 'joining' ? t('i.joinTitle') : i.actTitle[state] ?? '';
      const steps = $('[data-invite-steps]');
      steps.classList.toggle('is-join', state === 'joining');
      steps.replaceChildren(...(canSay && x ? i.steps(state, { due: x.due, c: this.addr, owed }).map((s) => el('li', { textContent: s })) : []));
      for (const s of ['[data-invite-steps]', '[data-invite-say]', '[data-invite-say-label]', '[data-invite-copy]', '[data-invite-risk]']) $(s).hidden = !canSay;
      // joining and paying need the Giliran skill: an agent without it learns where to get it
      if (canSay) $('[data-invite-say]').textContent = i.say(this.addr, state) + (C.skill ? d('skillLine')(C.skill) : '');
      $('[data-invite-cal]').hidden = !this.ics();
      const share = $('[data-invite-share]');
      share.hidden = state !== 'joining';
      share.href = `https://wa.me/?text=${encodeURIComponent(i.share(`https://${C.site}/?c=${this.addr}&lang=${lang}`))}`;
      $('[data-invite-retry]').hidden = state !== 'error';
      $('[data-invite-find]').hidden = state !== 'unknown';
      $('[data-invite-find] label').textContent = i.findLabel;
      $('[data-invite-find] button').textContent = i.findGo;
      const home = $('.invite__about');
      const lost = state === 'unknown';
      home.classList.toggle('btn', lost);
      home.classList.toggle('btn--primary', false);
      home.textContent = lost ? d('invite').goHome : t('i.about');
      $('[data-invite-note]').textContent = state === 'unknown' && /^[1-9]\d{0,8}$/.test(this.addr) ? i.noCircle(this.addr) : note;
      this.el.dataset.state = state;
      rupiah.paint();
    },
  };
  $('[data-invite-retry]').addEventListener('click', () => invite.load());
  $('[data-invite-cal]').addEventListener('click', () => {
    const ics = invite.ics();
    if (!ics) return;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })), download: `giliran-${invite.addr}.ics` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  });
  $('[data-invite-find]')?.addEventListener('submit', (e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('c').toString().replace(/\D/g, ''); if (/^[1-9]\d{0,5}$/.test(v)) location.search = `?c=${v}&lang=${lang}`; });
  $('[data-invite-copy]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try {
      await navigator.clipboard.writeText($('[data-invite-say]').textContent.trim());
      b.textContent = d('copied');
    } catch {
      b.textContent = d('copyByHand');
    }
    setTimeout(() => { b.textContent = t('i.copy'); }, 1800);
  });

  if (C.giliran) {
    $('[data-contract-link]').href = `${C.explorer}/address/${C.giliran}#code`;
    $('[data-contract]').hidden = false;
  }

  if (/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(C.repo)) {
    $('[data-repo-link]').href = C.repo;
    $('[data-repo]').hidden = false;
  }
  applyLang();
  const refit = () => $$('svg.ring').forEach((r) => Ring.fit(r));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { money.draw(); refit(); }, 150); });
  rupiah.load();
  pickBeat();
  invite.load();
})();
