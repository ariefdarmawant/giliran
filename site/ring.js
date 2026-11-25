// Draws a circle (arisan) as a ring: members around it, a money meter inside, labels in the middle.
// One renderer for the hero's live circle, the promises diagram and the composer preview.
(() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  /**
   * @param {object} o
   * @param {string[]} o.names member names, drawn clockwise from the top
   * @param {boolean[]} [o.paid] paid this round
   * @param {boolean[]} [o.received] already received a payout
   * @param {boolean[]} [o.late] carries a missed payment
   * @param {number} [o.meter] 0..1, money collected
   * @param {number} [o.held] 0..1, part of the meter held back as guarantee
   * @param {number|null} [o.pointer] index of the member the draw landed on
   * @param {{k?: string, amount?: string, of?: string, unit?: string, idr?: number, when?: string}} [o.center]
   *   `idr` is a USDT amount; its rupiah estimate is painted into that line by the page.
   */
  /** Two letters for a member: on their dot where names do not fit, and beside their name in the list. */
  const initials = (nm) => (nm[0] || '').toUpperCase() + (nm[1] || '');

  function svg(o) {
    const n = o.names.length, cx = 300, cy = 300, R = 200, LR = 246, MR = 150;
    const paid = o.paid || [], received = o.received || [], late = o.late || [];
    const meter = Math.max(0, Math.min(1, o.meter ?? 0));
    const held = Math.max(0, Math.min(meter, o.held ?? 0));
    const c = o.center || {};
    const at = (i, r) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a), a];
    };
    // a dot's initial; two letters where two members share a first letter
    const ini = o.names.map(initials);
    const nodes = o.names.map((name, i) => {
      const [x, y, a] = at(i, R);
      const [lx, ly] = at(i, LR);
      const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
      const s = Math.round(Math.sin(a) * 1000) / 1000; // round so equal angles left and right land on the same side
      const dy = s < -0.5 ? -6 : s >= 0.5 ? 18 : 6;
      const cls = ['node', paid[i] ? 'node--paid' : 'node--due', received[i] ? 'node--received' : '', late[i] ? 'node--late' : '', o.pointer === i ? 'node--drawn' : ''].filter(Boolean).join(' ');
      const core = received[i] ? `<circle class="node__halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22"/>` : ''; // a ring around the dot: already received a payout
      return `<g class="${cls}" data-i="${i}" style="--i:${i}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14"/>${core}<text class="node__i${ini[i].length > 1 ? ' node__i--2' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(ini[i])}</text><text x="${lx.toFixed(1)}" y="${(ly + dy).toFixed(1)}" text-anchor="${anchor}">${esc(name.length > 20 ? name.slice(0, 18) + '…' : name)}</text></g>`;
    }).join('');
    let pointer = '';
    if (o.pointer != null && o.pointer >= 0 && o.pointer < n) {
      // from the meter's edge to the member, so it never crosses the figures in the middle
      const [qx, qy] = at(o.pointer, MR + 14);
      const [px, py] = at(o.pointer, R - 22);
      pointer = `<line class="ring__pointer" x1="${qx.toFixed(1)}" y1="${qy.toFixed(1)}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" pathLength="1"/>`;
    }
    const heldArc = held > 0
      ? `<circle class="ring__held" cx="${cx}" cy="${cy}" r="${MR}" pathLength="100" stroke-dasharray="${(held * 100).toFixed(1)} 100" stroke-dashoffset="${(-(meter - held) * 100).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`
      : '';
    const amount = c.amount != null
      ? `<text class="ring__amount" x="${cx}" y="${cy + 24}" text-anchor="middle">${esc(c.amount)}${c.of ? `<tspan class="ring__of" dx="6">${esc(c.of)}</tspan>` : ''}</text>`
      : '';
    return `<circle class="ring__track" cx="${cx}" cy="${cy}" r="${R}"/>
      <circle class="ring__meter-track" cx="${cx}" cy="${cy}" r="${MR}"/>
      <circle class="ring__meter" cx="${cx}" cy="${cy}" r="${MR}" pathLength="100" stroke-dasharray="${((meter - held) * 100).toFixed(1)} 100" transform="rotate(-90 ${cx} ${cy})"${meter - held <= 0 ? ' style="opacity:0"' : meter - held < 0.05 ? ' style="stroke-linecap:butt"' : ''}/>
      ${heldArc}${pointer}${nodes}
      ${c.k ? `<text class="ring__k" x="${cx}" y="${cy - 82}" text-anchor="middle">${esc(c.k)}</text>` : ''}
      ${amount}
      ${c.unit ? `<text class="ring__unit" x="${cx}" y="${cy + 70}" text-anchor="middle">${esc(c.unit)}</text>` : ''}
      ${c.idr != null ? `<text class="ring__idr" x="${cx}" y="${cy + 84}" text-anchor="middle" data-idr="${Number(c.idr)}"></text>` : ''}
      ${c.when ? `<text class="ring__when" x="${cx}" y="${cy + (c.idr != null ? 122 : 96)}" text-anchor="middle">${esc(c.when)}</text>` : ''}`;
  }

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const point = (i, n, r) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [300 + r * Math.cos(a), 300 + r * Math.sin(a)];
  };

  /**
   * Money moving on the ring: each move is {from, to, at}, where from/to is a member's index or 'c' (the contract,
   * drawn as the meter in the middle) and `at` is a delay in ms. A small comet travels an arc between them.
   * Does nothing when the visitor asked for reduced motion.
   */
  function flow(el, moves) {
    if (reduced() || !moves.length || typeof el.getCurrentTime !== 'function') return;
    const n = el.querySelectorAll('.node').length;
    if (!n) return;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'flows');
    g.setAttribute('aria-hidden', 'true');
    const now = el.getCurrentTime();
    let end = 0;
    for (const m of moves) {
      const member = m.from === 'c' ? m.to : m.from;
      const [nx, ny] = point(member, n, 186);
      const [mx, my] = point(member, n, 156);
      const [cx, cy] = point(member + 0.28, n, 175);
      const path = m.from === 'c' ? `M${mx.toFixed(1)} ${my.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}` : `M${nx.toFixed(1)} ${ny.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
      const dur = 0.9;
      [0, 0.05, 0.1].forEach((lag, k) => {
        const begin = `${(now + (m.at || 0) / 1000 + lag).toFixed(3)}s`;
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', `flow__dot${m.from === 'c' ? ' flow__dot--pot' : ''}`);
        dot.setAttribute('r', String((m.from === 'c' ? 9 : 6) - k * 2));
        dot.setAttribute('opacity', '0');
        dot.innerHTML = `<animateMotion dur="${dur}s" begin="${begin}" path="${path}" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.65 0 0.35 1"/>`
          + `<animate attributeName="opacity" values="0;${1 - k * 0.3};${1 - k * 0.3};0" keyTimes="0;0.15;0.8;1" dur="${dur}s" begin="${begin}" fill="freeze"/>`;
        g.append(dot);
      });
      end = Math.max(end, (m.at || 0) + dur * 1000 + 200);
    }
    el.append(g);
    setTimeout(() => g.remove(), end + 100);
  }

  /** Squeeze any centre line wider than the inner circle so it never runs over the meter, in any language or size. */
  // one on-screen size for ring labels and centre lines on every page, whatever the drawing's scale
  const LABEL_PX = () => (matchMedia('(max-width: 40rem)').matches ? 13 : 15);
  function fit(el) {
    const vb = el.viewBox && el.viewBox.baseVal;
    const w = el.clientWidth || el.getBoundingClientRect().width; // layout width, not mid-zoom
    const scale = vb && vb.width && w ? w / vb.width : 0;
    if (scale) {
      el.querySelectorAll('.node text:not(.node__i)').forEach((t) => { t.style.fontSize = `${(LABEL_PX() / scale).toFixed(1)}px`; });
      el.querySelectorAll('.ring__k, .ring__unit, .ring__when').forEach((t) => { t.style.fontSize = `${(LABEL_PX() / scale).toFixed(1)}px`; });
    }
    el.querySelectorAll('.ring__k, .ring__unit, .ring__when, .ring__amount, .ring__idr').forEach((t) => {
      if (!scale || t.classList.contains('ring__amount') || t.classList.contains('ring__idr')) t.style.fontSize = '';
      let w = 0;
      try { w = t.getBBox().width; } catch { return; }
      // the inner circle (radius ~134 with a margin) is narrower away from the middle: fit each line to its height
      const fsNow = parseFloat(getComputedStyle(t).fontSize) || 18;
      const y = Number(t.getAttribute('y')) || 300;
      const edge = y < 300 ? 300 - (y - fsNow * 0.8) : y + fsNow * 0.25 - 300;
      const chord = 2 * Math.sqrt(Math.max(0, 134 * 134 - edge * edge));
      const max = Math.min(t.classList.contains('ring__amount') ? 214 : 196, chord);
      if (w > max) {
        const fs = parseFloat(getComputedStyle(t).fontSize);
        if (fs) t.style.fontSize = `${(fs * max / w).toFixed(1)}px`; // smaller type, never stretched letters
      }
    });
  }
  /** Crop the drawing's height to what it shows (a three-member ring has no empty band under it); the width,
   *  and so the scale, stays fixed whatever the member count. */
  function frame(el) {
    // phones: no outer names (they would run off a narrow card); the drawing crops to the circle, so it is big
    const phone = matchMedia('(max-width: 40rem)').matches;
    if (phone && !el.classList.contains('ring--named')) { el.setAttribute('viewBox', '76 76 448 448'); return; }
    const [x0, w] = phone ? [-110, 820] : [-70, 740];
    try {
      el.setAttribute('viewBox', `${x0} 0 ${w} 600`);
      const b = el.getBBox();
      if (b.height) el.setAttribute('viewBox', `${x0} ${(b.y - 16).toFixed(0)} ${w} ${(b.height + 32).toFixed(0)}`);
    } catch { /* not rendered yet: keep the default frame */ }
  }

  window.GiliranRing = {
    svg,
    flow,
    fit,
    reduced,
    initials,
    /** A key under a ring: [[state, words], ...], each with the dot it explains. */
    keys(el, items) {
      if (!el) return;
      el.replaceChildren(...(items || []).map(([k, words]) => Object.assign(document.createElement('span'), { className: `key key--${k}`, textContent: words })));
    },
    /** Replace an <svg class="ring">'s contents and its accessible label. */
    render(el, o, label) {
      el.innerHTML = svg(o);
      el.classList.toggle('ring--many', o.names.length > 8 || o.names.some((n) => n.length > 20)); // a big circle shows its seats; the names are listed beside it
      if (el.classList.contains('ring--small') && (!el.hasAttribute('data-composer-ring') || matchMedia('(max-width: 40rem)').matches)) frame(el); // on desktop the composer keeps one frame, so nothing jumps while typing
      fit(el);
      if (label) {
        el.removeAttribute('aria-labelledby');
        el.setAttribute('aria-label', label);
      }
    },
  };
})();
