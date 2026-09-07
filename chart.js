/* ============================================================
   Family tree: the classic chart.

   Boxes in generation rows, joined by right-angle connectors.
   A couple gets a bar between them, and their children hang from
   the middle of that bar. Drawn as SVG, panned and zoomed by a
   transform on one group, so the boxes stay crisp at any scale.

   Colours live in styles.css. Everything here draws classed shapes
   and lets the stylesheet decide how they look.

   The people graph is not a tree: a person has up to two parents,
   each with their own ancestry, and someone who marries in brings a
   whole line with them. So this lays out in generation rows and
   orders each row by where its relatives sit (a barycentre sweep),
   rather than by recursing down a single trunk.
   ============================================================ */

'use strict';

(function () {

const BOX_W = 176;
const BOX_H = 62;
const GAP_X = 30;        // between neighbouring boxes
const GAP_COUPLE = 16;   // between two spouses, tighter so a couple reads as one
const ROW_GAP = 104;     // between generation rows
const STUB = 26;         // drop from a parent box to the couple bar
const SIB_LIFT = 30;     // height of the sibling bar above the children
const GROUP_GAP = 120;   // between two families that share nobody
const SWEEPS = 12;       // ordering passes; settles well before this on real trees

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/* ---------- grouping ---------- */

// People joined inside one generation become a single unit, so a couple is
// placed as a block and a remarriage keeps both spouses alongside. Sharing a
// child counts as well as a recorded marriage: parents entered before
// marriages existed, or never married at all, still belong side by side.
function buildUnits(people, marriages, levels, families) {
  const parent = new Map(people.map((p) => [p.id, p.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  const pairs = marriages.map((m) => [m.a, m.b]);
  for (const f of families) {
    for (let i = 1; i < f.parents.length; i++) pairs.push([f.parents[0], f.parents[i]]);
  }
  for (const [a, b] of pairs) {
    if (!parent.has(a) || !parent.has(b)) continue;
    if (levels.get(a) === levels.get(b)) union(a, b);
  }

  const byRoot = new Map();
  for (const p of people) {
    const r = find(p.id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(p.id);
  }
  const units = [];
  for (const members of byRoot.values()) {
    units.push({ members, level: levels.get(members[0]) || 0, x: 0 });
  }
  return units;
}

// One entry per distinct set of parents, holding the children they share.
function buildFamilies(people, has) {
  const families = new Map();
  for (const p of people) {
    const parents = p.parents.filter(has);
    if (!parents.length) continue;
    const key = [...parents].sort().join('+');
    if (!families.has(key)) families.set(key, { parents, children: [] });
    families.get(key).children.push(p.id);
  }
  return [...families.values()];
}

/* ---------- ordering and placement ---------- */

// Mean position of a list of units, used to pull a row towards its relatives.
function meanX(units) {
  if (!units.length) return null;
  let sum = 0;
  for (const u of units) sum += u.x;
  return sum / units.length;
}

// Pack a row left to right at fixed spacing, preserving the given order.
function packRow(row) {
  let x = 0;
  for (const u of row) {
    u.x = x + u.width / 2;
    x += u.width + GAP_X;
  }
}

function layout(people, marriages, levels) {
  const has = (id) => people.some((p) => p.id === id);
  const families = buildFamilies(people, has);
  const units = buildUnits(people, marriages, levels, families);
  const unitOf = new Map();
  for (const u of units) {
    u.width = u.members.length * BOX_W + (u.members.length - 1) * GAP_COUPLE;
    for (const id of u.members) unitOf.set(id, u);
  }

  // Which units sit above and below each unit, through the families it joins.
  const up = new Map(units.map((u) => [u, new Set()]));
  const down = new Map(units.map((u) => [u, new Set()]));
  for (const f of families) {
    const pu = unitOf.get(f.parents[0]);
    if (!pu) continue;
    for (const c of f.children) {
      const cu = unitOf.get(c);
      if (!cu || cu === pu) continue;
      up.get(cu).add(pu);
      down.get(pu).add(cu);
    }
  }

  // Seat everyone in a unit so that each married pair ends up side by side.
  // With a remarriage the unit is a chain (first wife, husband, second wife)
  // and walking it from an end is what keeps both bars short. Laying it out in
  // any other order put the ex-wife between the current couple, and their bar
  // then ran straight across her, reading as the wrong pairing. Direction is
  // decided later, once the rows have found their places.
  for (const u of units) {
    if (u.members.length < 2) continue;
    const inUnit = new Set(u.members);
    const adj = new Map(u.members.map((id) => [id, []]));
    const link = (a, b) => {
      if (!inUnit.has(a) || !inUnit.has(b)) return;
      if (adj.get(a).includes(b)) return;
      adj.get(a).push(b);
      adj.get(b).push(a);
    };
    for (const m of marriages) link(m.a, m.b);
    for (const f of families) {
      for (let i = 1; i < f.parents.length; i++) link(f.parents[0], f.parents[i]);
    }
    const ends = u.members.filter((id) => adj.get(id).length <= 1);
    const seen = new Set();
    const chain = [];
    for (const start of [...ends, ...u.members]) {
      if (seen.has(start)) continue;
      let cur = start;
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        chain.push(cur);
        cur = adj.get(cur).find((n) => !seen.has(n));
      }
    }
    u.members = chain;
  }

  const depths = [...new Set(units.map((u) => u.level))].sort((a, b) => a - b);
  const born = new Map(people.map((p) => [p.id, (p.birthDate || '').slice(-4)]));

  const parentMid = (id) => {
    const p = people.find((q) => q.id === id);
    const seats = (p ? p.parents : []).map((pid) => unitOf.get(pid)).filter(Boolean);
    return seats.length ? meanX(seats) : null;
  };

  // Order and position one group of related units. Rows are the generations
  // this group actually occupies, so a group spanning two generations is not
  // dragged around by one spanning five.
  function arrange(group) {
    const rows = depths
      .map((d) => group.filter((u) => u.level === d))
      .filter((row) => row.length);

    // Start in birth order so the result is stable run to run.
    for (const row of rows) {
      row.sort((a, b) => (born.get(a.members[0]) || '').localeCompare(born.get(b.members[0]) || ''));
      packRow(row);
    }

    // Alternate sweeps: order each row by where its parents sit, then by where
    // its children sit. A few rounds is enough to untangle ordinary trees.
    for (let pass = 0; pass < SWEEPS; pass++) {
      const downward = pass % 2 === 0;
      const order = downward ? rows : [...rows].reverse();
      for (const row of order) {
        const side = downward ? up : down;
        const keyed = row.map((u, i) => {
          const bary = meanX([...side.get(u)]);
          return { u, key: bary === null ? u.x : bary, i };
        });
        keyed.sort((a, b) => (a.key - b.key) || (a.i - b.i));
        row.length = 0;
        for (const k of keyed) row.push(k.u);
        packRow(row);
      }
    }

    // Nudge each unit towards the middle of its relatives, then push apart
    // anything that ended up overlapping. Repeated a few times to settle.
    const refine = (rounds) => {
      for (let pass = 0; pass < rounds; pass++) {
        for (const row of rows) {
          for (const u of row) {
            const target = meanX([...up.get(u), ...down.get(u)]);
            if (target !== null) u.x += (target - u.x) * 0.5;
          }
          row.sort((a, b) => a.x - b.x);
          // left to right, then right to left, so the row keeps its centre
          for (let i = 1; i < row.length; i++) {
            const need = row[i - 1].x + row[i - 1].width / 2 + GAP_X + row[i].width / 2;
            if (row[i].x < need) row[i].x = need;
          }
          for (let i = row.length - 2; i >= 0; i--) {
            const cap = row[i + 1].x - row[i + 1].width / 2 - GAP_X - row[i].width / 2;
            if (row[i].x > cap) row[i].x = cap;
          }
        }
      }
    };
    refine(6);

    // Point each chain so a person sits on the side their own parents are on,
    // then let the rows settle again with those seats in place.
    for (const u of group) {
      if (u.members.length < 2) continue;
      const head = parentMid(u.members[0]);
      const tail = parentMid(u.members[u.members.length - 1]);
      if (head === null && tail === null) continue;
      const flip = (head === null && tail !== null)
        ? tail < u.x
        : (tail === null ? head > u.x : head > tail);
      if (flip) u.members.reverse();
    }
    refine(6);
  }

  // Unrelated families are separate groups. Each is arranged on its own and
  // then given its own band of width, so two families never interleave in a
  // row. Generation rows stay shared, so the groups still line up vertically
  // and the chart simply grows sideways as more of them are added.
  const groups = [];
  const placed = new Set();
  for (const seed of units) {
    if (placed.has(seed)) continue;
    const group = [];
    const queue = [seed];
    placed.add(seed);
    while (queue.length) {
      const u = queue.shift();
      group.push(u);
      for (const n of [...up.get(u), ...down.get(u)]) {
        if (placed.has(n)) continue;
        placed.add(n);
        queue.push(n);
      }
    }
    groups.push(group);
  }

  // Biggest family first, so the chart opens on the main line.
  groups.sort((a, b) => b.length - a.length);
  let cursor = 0;
  for (const group of groups) {
    arrange(group);
    const left = Math.min(...group.map((u) => u.x - u.width / 2));
    const right = Math.max(...group.map((u) => u.x + u.width / 2));
    const shift = cursor - left;
    for (const u of group) u.x += shift;
    cursor += (right - left) + GROUP_GAP;
  }

  // Turn units into per-person boxes.
  const box = new Map();
  const topOf = (level) => depths.indexOf(level) * (BOX_H + ROW_GAP);
  for (const u of units) {
    const left = u.x - u.width / 2;
    u.members.forEach((id, i) => {
      box.set(id, {
        id,
        x: left + i * (BOX_W + GAP_COUPLE),
        y: topOf(u.level),
        w: BOX_W,
        h: BOX_H,
      });
    });
  }
  return { box, families, units };
}

/* ---------- drawing ---------- */

function centre(b) {
  return b.x + b.w / 2;
}

function connectors(box, families) {
  const paths = [];
  for (const f of families) {
    const pb = f.parents.map((id) => box.get(id)).filter(Boolean);
    const cb = f.children.map((id) => box.get(id)).filter(Boolean);
    if (!pb.length || !cb.length) continue;

    const parentBottom = Math.max(...pb.map((b) => b.y + b.h));
    const barY = parentBottom + STUB;
    // stub down from each parent, joined by a bar when there are two of them
    for (const b of pb) paths.push(`M ${centre(b)} ${b.y + b.h} L ${centre(b)} ${barY}`);
    if (pb.length > 1) {
      const xs = pb.map(centre);
      paths.push(`M ${Math.min(...xs)} ${barY} L ${Math.max(...xs)} ${barY}`);
    }

    const junction = pb.length > 1
      ? (Math.min(...pb.map(centre)) + Math.max(...pb.map(centre))) / 2
      : centre(pb[0]);
    const childTop = Math.min(...cb.map((b) => b.y));
    const sibY = childTop - SIB_LIFT;
    paths.push(`M ${junction} ${barY} L ${junction} ${sibY}`);
    // The sibling bar has to reach the junction as well as the children.
    // An only child rarely sits directly under its parents, and without this
    // the drop line and the child's riser never met.
    const xs = cb.map(centre);
    const lo = Math.min(junction, ...xs);
    const hi = Math.max(junction, ...xs);
    if (hi - lo > 0.5) paths.push(`M ${lo} ${sibY} L ${hi} ${sibY}`);
    for (const b of cb) paths.push(`M ${centre(b)} ${sibY} L ${centre(b)} ${b.y}`);
  }
  return paths;
}

// A marriage with no children still gets a bar, otherwise the couple would
// float side by side with nothing saying they are a couple.
function marriageLabel(m, labels) {
  const parts = [labels.marriage];
  if (m.date) parts.push(m.date);
  if (m.place) parts.push(m.place);
  if (m.status === 'divorced') parts.push(m.endDate ? `${labels.divorced} ${m.endDate}` : labels.divorced);
  return parts.join(' · ');
}

function marriageBars(box, marriages, families) {
  const withKids = new Set(families.map((f) => [...f.parents].sort().join('+')));
  const out = [];
  for (const m of marriages) {
    if (withKids.has([m.a, m.b].sort().join('+'))) continue;
    const a = box.get(m.a);
    const b = box.get(m.b);
    if (!a || !b) continue;
    const ex = m.status === 'divorced';
    const gapL = Math.min(a.x + a.w, b.x + b.w);
    const gapR = Math.max(a.x, b.x);
    const neighbours = gapR - gapL < GAP_X * 1.6;
    if (neighbours) {
      const y = Math.max(a.y, b.y) + BOX_H / 2;
      out.push({ d: `M ${Math.min(gapL, gapR)} ${y} L ${Math.max(gapL, gapR)} ${y}`, ex, m });
      continue;
    }
    // Far apart: drop below both boxes and run across, so the line never
    // passes through somebody else's box.
    const y = Math.max(a.y + a.h, b.y + b.h) + STUB / 2;
    out.push({
      d: `M ${centre(a)} ${a.y + a.h} L ${centre(a)} ${y} L ${centre(b)} ${y} L ${centre(b)} ${b.y + b.h}`,
      ex,
      m,
    });
  }
  return out;
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/* ---------- public entry ---------- */

// Draws the whole chart into `host`. `opts` supplies the data and the small
// bits of app state the chart needs: which person is focused or selected,
// how to label someone, and what to do on a click.
function render(host, opts) {
  const { people, marriages, levels, nameOf, labelOf, datesOf, placeOf, noteOf, labels, focusId, selectedId, onPick } = opts;
  host.textContent = '';
  if (!people.length) return null;

  const { box, families } = layout(people, marriages, levels);
  // Set while the pointer is being dragged across the canvas, so the click
  // that ends a drag does not also open whichever box it landed on.
  let dragMoved = false;
  const svg = el('svg', { class: 'chart-svg' });
  const root = el('g');
  svg.appendChild(root);

  const wires = el('g', { class: 'chart-wires' });
  for (const d of connectors(box, families)) wires.appendChild(el('path', { d }));
  root.appendChild(wires);

  const bars = el('g');
  for (const bar of marriageBars(box, marriages, families)) {
    const path = el('path', { d: bar.d, class: bar.ex ? 'chart-bar ex' : 'chart-bar' });
    if (labels) {
      const tip = el('title');
      tip.textContent = marriageLabel(bar.m, labels);
      path.appendChild(tip);
    }
    bars.appendChild(path);
  }
  root.appendChild(bars);

  const boxes = el('g');
  for (const p of people) {
    const b = box.get(p.id);
    if (!b) continue;
    const g = el('g', { class: 'chart-node', 'data-id': p.id });
    if (p.id === focusId) g.classList.add('is-focus');
    if (p.id === selectedId) g.classList.add('is-selected');
    if (p.deathDate) g.classList.add('is-dead');

    g.appendChild(el('rect', { class: 'chart-box', x: b.x, y: b.y, width: b.w, height: b.h, rx: 12 }));
    // Surname above, given name and patronymic below, dates last. One long
    // line would just be cut off; split this way a full Russian name fits.
    const label = labelOf(p);
    const surname = el('text', { class: 'chart-name', x: centre(b), y: b.y + 19 });
    surname.textContent = truncate(label.surname || label.given, 24);
    g.appendChild(surname);
    if (label.surname && label.given) {
      const given = el('text', { class: 'chart-given', x: centre(b), y: b.y + 35 });
      given.textContent = truncate(label.given, 24);
      g.appendChild(given);
    }
    const dates = datesOf(p);
    if (dates) {
      const d = el('text', { class: 'chart-dates', x: centre(b), y: b.y + 51 });
      d.textContent = dates;
      g.appendChild(d);
    }
    // Hovering shows the full name plus anything the box had no room for.
    const place = placeOf ? placeOf(p) : '';
    const note = noteOf ? noteOf(p) : '';
    const full = el('title');
    full.textContent = [nameOf(p), dates, place].filter(Boolean).join(' · ')
      + (note ? `\n${truncate(note, 200)}` : '');
    g.appendChild(full);
    g.addEventListener('click', () => {
      if (dragMoved) return;
      if (onPick) onPick(p.id);
    });
    boxes.appendChild(g);
  }
  root.appendChild(boxes);
  host.appendChild(svg);

  /* ---------- pan and zoom ---------- */
  const bounds = [...box.values()].reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.x), maxX: Math.max(acc.maxX, b.x + b.w),
    minY: Math.min(acc.minY, b.y), maxY: Math.max(acc.maxY, b.y + b.h),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

  const view = { x: 0, y: 0, k: 1 };
  const apply = () => root.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);

  function fit() {
    const pad = 46;
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    const cw = bounds.maxX - bounds.minX + pad * 2;
    const ch = bounds.maxY - bounds.minY + pad * 2;
    view.k = Math.min(w / cw, h / ch, 1.4);
    view.x = w / 2 - (bounds.minX + bounds.maxX) / 2 * view.k;
    view.y = h / 2 - (bounds.minY + bounds.maxY) / 2 * view.k;
    apply();
  }

  function zoomBy(factor, cx, cy) {
    const next = Math.min(3, Math.max(0.15, view.k * factor));
    // keep the point under the cursor still while the scale changes
    view.x = cx - (cx - view.x) * (next / view.k);
    view.y = cy - (cy - view.y) * (next / view.k);
    view.k = next;
    apply();
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Panning deliberately does not grab the pointer until it has actually
  // moved. Capturing on pointerdown makes the browser deliver the click to the
  // capturing element instead of the box under the cursor, which silently
  // killed click-to-edit on the chart.
  const DRAG_SLOP = 4;
  let dragging = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragMoved = false;
    dragging = { x: e.clientX - view.x, y: e.clientY - view.y, sx: e.clientX, sy: e.clientY, id: e.pointerId };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (!dragMoved) {
      if (Math.hypot(e.clientX - dragging.sx, e.clientY - dragging.sy) < DRAG_SLOP) return;
      dragMoved = true;
      svg.setPointerCapture(dragging.id);
      svg.classList.add('is-dragging');
    }
    view.x = e.clientX - dragging.x;
    view.y = e.clientY - dragging.y;
    apply();
  });
  const endDrag = () => {
    if (dragging && dragMoved && svg.hasPointerCapture(dragging.id)) {
      svg.releasePointerCapture(dragging.id);
    }
    dragging = null;
    svg.classList.remove('is-dragging');
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  fit();
  return {
    fit,
    zoomIn: () => zoomBy(1.25, host.clientWidth / 2, host.clientHeight / 2),
    zoomOut: () => zoomBy(1 / 1.25, host.clientWidth / 2, host.clientHeight / 2),
    // bring one person into the middle without changing the zoom
    centreOn: (id) => {
      const b = box.get(id);
      if (!b) return;
      view.x = host.clientWidth / 2 - centre(b) * view.k;
      view.y = host.clientHeight / 2 - (b.y + b.h / 2) * view.k;
      apply();
    },
  };
}

window.FamilyChart = { render };

})();
