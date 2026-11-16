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
   whole line with them. So it is cut into branches, one line of
   descent each, traced through fathers. Each branch is a real tree
   and is laid out as one, in its own block. Blocks sit side by side
   in generation rows, and the only lines between them are marriages.
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
const BRANCH_GAP = 80;   // between two branches: only marriages cross it
const GROUP_GAP = 120;   // between two families that share nobody
const SEARCH_LIMIT = 6;  // up to this many linked branches, every order is tried

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/* ---------- generations ---------- */

// Generation of every person: 0 with no parents in the tree, otherwise one
// past the deepest parent. Spouses are pulled onto the same generation so a
// couple sits side by side even when one of them married in from nowhere.
function generations(people, marriages) {
  const level = new Map(people.map((p) => [p.id, 0]));
  const kids = new Map(people.map((p) => [p.id, []]));
  for (const p of people) {
    for (const pid of p.parents) if (kids.has(pid)) kids.get(pid).push(p.id);
  }

  // Pairs that have to share a generation. A recorded marriage is one, and so
  // is sharing a child: a wife with no parents of her own would otherwise stay
  // at the top while her husband moved down as his own parents were added.
  const pairs = [];
  for (const m of marriages) {
    if (level.has(m.a) && level.has(m.b)) pairs.push([m.a, m.b]);
  }
  for (const p of people) {
    const ps = p.parents.filter((id) => level.has(id));
    for (let i = 1; i < ps.length; i++) pairs.push([ps[0], ps[i]]);
  }
  // Siblings share a generation too. Without this, one sibling pulled down to
  // sit beside a spouse from a deeper line left the others a row higher, and
  // the parents stayed with them, two rows above the moved child with her
  // line running behind a sibling's box.
  for (const cs of kids.values()) {
    for (let i = 1; i < cs.length; i++) pairs.push([cs[0], cs[i]]);
  }

  // Relax until nothing moves. Every rule only ever pushes someone further
  // down the page, and the constraints agree at the point where a parent sits
  // exactly one row above their nearest child, so this settles; the counter is
  // a guard rather than the real bound.
  for (let guard = 0; guard <= people.length * 2 + 8; guard++) {
    let changed = false;
    // a child sits below its deepest parent
    for (const p of people) {
      for (const pid of p.parents) {
        if (!level.has(pid)) continue;
        const want = level.get(pid) + 1;
        if (want > level.get(p.id)) { level.set(p.id, want); changed = true; }
      }
    }
    // a parent sits directly above its nearest child, so parents-in-law follow
    // a daughter who was pulled down to sit beside the person she married
    for (const p of people) {
      const cs = kids.get(p.id);
      if (!cs.length) continue;
      const want = Math.min(...cs.map((c) => level.get(c))) - 1;
      if (want > level.get(p.id)) { level.set(p.id, want); changed = true; }
    }
    for (const [a, b] of pairs) {
      const hi = Math.max(level.get(a), level.get(b));
      if (level.get(a) !== hi) { level.set(a, hi); changed = true; }
      if (level.get(b) !== hi) { level.set(b, hi); changed = true; }
    }
    if (!changed) break;
  }
  return level;
}

/* ---------- branches ---------- */

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

// Who leads a line: a man, then someone whose sex is not filled in, then a
// woman. Ties go to the lower id, so the choice is stable.
const leadRank = (q) => (q.gender === 'М' ? 0 : (q.gender === 'Ж' ? 2 : 1));
const leads = (a, b) => leadRank(a) < leadRank(b) || (leadRank(a) === leadRank(b) && a.id < b.id);

// The parent a person's line runs through: the father when known, as a
// surname does, otherwise the mother.
function lineParent(p, byId) {
  const ps = p.parents.map((id) => byId.get(id)).filter(Boolean);
  if (!ps.length) return null;
  return ps.reduce((best, q) => (leads(q, best) ? q : best));
}

// Partners: a recorded marriage, or two people who share a child.
function partnersOf(people, marriages, byId) {
  const out = new Map(people.map((p) => [p.id, []]));
  const add = (a, b) => {
    if (!out.has(a) || !out.has(b) || a === b || out.get(a).includes(b)) return;
    out.get(a).push(b);
    out.get(b).push(a);
  };
  for (const m of marriages) add(m.a, m.b);
  for (const p of people) {
    const ps = p.parents.filter((id) => byId.has(id));
    for (let i = 1; i < ps.length; i++) add(ps[0], ps[i]);
  }
  return out;
}

// Splits everyone into branches: the line of descent each person was born
// into, traced through fathers. Someone with no parents recorded joins the
// branch of the person they married, because there is no family of theirs to
// draw. Of a couple where neither has parents, the husband founds the branch.
// Returns the branch per person and, for those who joined, through whom.
function assignBranches(people, byId, partners) {
  const branch = new Map();
  const joinedVia = new Map();
  const resolving = new Set();
  function resolve(id) {
    if (branch.has(id)) return branch.get(id);
    if (resolving.has(id)) return id; // a loop in the data: stop here
    resolving.add(id);
    const p = byId.get(id);
    const up = lineParent(p, byId);
    let key = id;
    if (up) {
      key = resolve(up.id);
    } else {
      const mates = partners.get(id).map((m) => byId.get(m));
      // Exactly one of a couple with no parents founds the branch, even when
      // neither has their sex filled in.
      const via = mates.find((m) => lineParent(m, byId)) || mates.find((m) => leads(m, p));
      if (via) {
        key = resolve(via.id);
        joinedVia.set(id, via.id);
      }
    }
    resolving.delete(id);
    branch.set(id, key);
    return key;
  }
  for (const p of people) resolve(p.id);
  return { branch, joinedVia };
}

// A unit is one person of the branch's own blood plus whoever joined the
// branch through them, drawn side by side as one block. Each unit hangs under
// the unit of the parent its line runs through, so a branch is a plain tree.
function buildUnits(people, byId, branch, joinedVia, levels) {
  const anchorOf = (id) => {
    const seen = new Set();
    let cur = id;
    while (joinedVia.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = joinedVia.get(cur);
    }
    return cur;
  };
  const byAnchor = new Map();
  const unitOf = new Map();
  for (const p of people) {
    const a = anchorOf(p.id);
    if (!byAnchor.has(a)) {
      byAnchor.set(a, { anchor: a, joined: [], level: levels.get(a) || 0, branch: branch.get(a), kids: [], parent: null });
    }
    const u = byAnchor.get(a);
    if (p.id !== a) u.joined.push(p.id);
    unitOf.set(p.id, u);
  }
  for (const p of people) {
    if (joinedVia.has(p.id)) continue;
    const up = lineParent(p, byId);
    if (!up) continue;
    const parent = unitOf.get(up.id);
    const child = unitOf.get(p.id);
    if (parent && child && parent !== child && !child.parent) {
      child.parent = parent;
      parent.kids.push(child);
    }
  }
  return [...byAnchor.values()];
}

/* ---------- placement ---------- */

// Places a list of subtrees side by side as close as their outlines allow.
// Each shape maps a row to its left (lo) and right (hi) edge, relative to the
// subtree's own centre. Returns where each one went and the combined outline.
function lineUp(shapes, gap) {
  const xs = [];
  const lo = new Map();
  const hi = new Map();
  for (const s of shapes) {
    let x = -Infinity;
    for (const [row, l] of s.lo) if (hi.has(row)) x = Math.max(x, hi.get(row) - l + gap);
    if (x === -Infinity) {
      // no row in common, e.g. two roots of different generations
      x = xs.length ? Math.max(...hi.values()) - Math.min(...s.lo.values()) + gap : 0;
    }
    xs.push(x);
    for (const [row, l] of s.lo) lo.set(row, Math.min(lo.has(row) ? lo.get(row) : Infinity, l + x));
    for (const [row, h] of s.hi) hi.set(row, Math.max(hi.has(row) ? hi.get(row) : -Infinity, h + x));
  }
  return { xs, lo, hi };
}

function shift(shape, dx) {
  const move = (m) => new Map([...m].map(([row, v]) => [row, v + dx]));
  return { lo: move(shape.lo), hi: move(shape.hi) };
}

// Birth date as a sortable string; unknown dates go last.
function birthKey(p) {
  const [y, m, d] = (p.birthDate || '').split('-').reverse();
  return y ? y.padStart(4, '0') + (m || '00').padStart(2, '0') + (d || '00').padStart(2, '0') : '99999999';
}

function layout(people, marriages, levels) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const families = buildFamilies(people, (id) => byId.has(id));
  const partners = partnersOf(people, marriages, byId);
  const { branch, joinedVia } = assignBranches(people, byId, partners);
  const units = buildUnits(people, byId, branch, joinedVia, levels);

  const branches = new Map();
  for (const u of units) {
    if (!branches.has(u.branch)) branches.set(u.branch, { key: u.branch, roots: [], size: 0 });
    const b = branches.get(u.branch);
    b.size += 1 + u.joined.length;
    if (!u.parent) b.roots.push(u);
  }
  // A loop in the data leaves units no root reaches. Make them roots, so
  // nobody silently drops out of the chart.
  const reached = new Set();
  const reach = (u) => { reached.add(u); for (const k of u.kids) if (!reached.has(k)) reach(k); };
  for (const b of branches.values()) b.roots.forEach(reach);
  for (const u of units) {
    if (reached.has(u)) continue;
    if (u.parent) u.parent.kids = u.parent.kids.filter((k) => k !== u);
    u.parent = null;
    branches.get(u.branch).roots.push(u);
    reach(u);
  }

  // Marriages across branches: the only lines that cross between them.
  const across = [];
  for (const [a, mates] of partners) {
    for (const m of mates) if (a < m && branch.get(a) !== branch.get(m)) across.push([a, m]);
  }

  // Which way each person's marriages into other branches point, given an
  // order of branches: negative to the left, positive to the right. Subtrees
  // and spouses lean that way, so a person who married out sits at the edge
  // of their branch facing their partner.
  function leanings(idx) {
    const lean = new Map();
    for (const [a, m] of across) {
      const ia = idx.get(branch.get(a));
      const im = idx.get(branch.get(m));
      if (ia === undefined || im === undefined) continue;
      lean.set(a, (lean.get(a) || 0) + Math.sign(im - ia));
      lean.set(m, (lean.get(m) || 0) + Math.sign(ia - im));
    }
    return lean;
  }

  // Lays one branch out as a tree: siblings side by side under their parents,
  // each one's descendants kept under them, so branches within a branch never
  // interleave either.
  function shapeBranch(b, lean) {
    const subtreeLean = new Map();
    const leanOf = (u) => {
      if (subtreeLean.has(u)) return subtreeLean.get(u);
      let sum = [u.anchor, ...u.joined].reduce((s, id) => s + (lean.get(id) || 0), 0);
      for (const k of u.kids) sum += leanOf(k);
      subtreeLean.set(u, sum);
      return sum;
    };
    const order = (list) => [...list].sort((x, y) => (Math.sign(leanOf(x)) - Math.sign(leanOf(y)))
      || birthKey(byId.get(x.anchor)).localeCompare(birthKey(byId.get(y.anchor))));
    // Under a couple, a child of one partner only goes on that partner's side
    // and their shared children between, so the lines down do not cross.
    const seatOf = (u, kid) => {
      const idx = byId.get(kid.anchor).parents.map((id) => u.members.indexOf(id)).filter((i) => i >= 0);
      return idx.length ? idx.reduce((a, b) => a + b, 0) / idx.length : (u.members.length - 1) / 2;
    };

    function outline(u) {
      const own = lean.get(u.anchor) || 0;
      if (u.joined.length === 1) {
        const anchorLeft = own < 0 || (own === 0 && byId.get(u.anchor).gender !== 'Ж');
        u.members = anchorLeft ? [u.anchor, u.joined[0]] : [u.joined[0], u.anchor];
      } else {
        // a remarriage: the person between their partners
        const half = Math.ceil(u.joined.length / 2);
        u.members = [...u.joined.slice(0, half), u.anchor, ...u.joined.slice(half)];
      }
      u.width = u.members.length * BOX_W + (u.members.length - 1) * GAP_COUPLE;
      const kids = order(u.kids).sort((x, y) => seatOf(u, x) - seatOf(u, y));
      const shape = { lo: new Map(), hi: new Map() };
      if (kids.length) {
        const placed = lineUp(kids.map(outline), GAP_X);
        const mid = (placed.xs[0] + placed.xs[placed.xs.length - 1]) / 2;
        kids.forEach((k, i) => { k.dx = placed.xs[i] - mid; });
        Object.assign(shape, shift(placed, -mid));
      }
      shape.lo.set(u.level, Math.min(shape.lo.has(u.level) ? shape.lo.get(u.level) : Infinity, -u.width / 2));
      shape.hi.set(u.level, Math.max(shape.hi.has(u.level) ? shape.hi.get(u.level) : -Infinity, u.width / 2));
      return shape;
    }

    const roots = order(b.roots);
    const placed = lineUp(roots.map(outline), GAP_X);
    roots.forEach((r, i) => { r.dx = placed.xs[i]; });
    b.rootsInOrder = roots;
    b.shape = { lo: placed.lo, hi: placed.hi };
  }

  // Branches go left to right, each slid as close to the ones before as its
  // outline allows, so a short branch can tuck under a tall one's empty rows.
  // A branch never starts left of the one before it.
  function pack(order) {
    const sky = new Map();
    let floor = -Infinity;
    for (const b of order) {
      const left = Math.min(...b.shape.lo.values());
      let x = -Infinity;
      for (const [row, l] of b.shape.lo) if (sky.has(row)) x = Math.max(x, sky.get(row) - l + BRANCH_GAP);
      if (x === -Infinity) x = -left;
      x = Math.max(x, floor - left);
      floor = x + left;
      b.x = x;
      for (const [row, h] of b.shape.hi) sky.set(row, Math.max(sky.has(row) ? sky.get(row) : -Infinity, h + x));
    }
  }

  // Left edge and row of every box, from the placed branches.
  function seats(order) {
    const out = new Map();
    const visit = (u, x) => {
      const left = x - u.width / 2;
      u.members.forEach((id, i) => out.set(id, { x: left + i * (BOX_W + GAP_COUPLE), level: u.level }));
      for (const k of u.kids) visit(k, x + k.dx);
    };
    for (const b of order) for (const r of b.rootsInOrder) visit(r, b.x + r.dx);
    return out;
  }

  function arrange(order) {
    const lean = leanings(new Map(order.map((b, i) => [b.key, i])));
    for (const b of order) shapeBranch(b, lean);
    pack(order);
    return seats(order);
  }

  // How bad an order is: a marriage line that has to pass other people's
  // boxes costs most, then the length of marriage lines and of the lines down
  // to the children of a marriage across branches, then overall width.
  function cost(seat, links) {
    const centre = (id) => seat.get(id).x + BOX_W / 2;
    const rows = new Map();
    for (const s of seat.values()) {
      if (!rows.has(s.level)) rows.set(s.level, []);
      rows.get(s.level).push(s.x);
    }
    let c = 0;
    for (const [a, m] of links) {
      const A = seat.get(a);
      const M = seat.get(m);
      const lo = Math.min(A.x, M.x);
      const hi = Math.max(A.x, M.x);
      c += (hi - lo) / BOX_W;
      if (A.level !== M.level) c += 10;
      else for (const x of rows.get(A.level)) if (x > lo && x < hi) c += 10;
    }
    for (const f of families) {
      const ps = f.parents.filter((id) => seat.has(id));
      if (ps.length < 2 || branch.get(ps[0]) === branch.get(ps[1])) continue;
      const mid = (centre(ps[0]) + centre(ps[1])) / 2;
      const kids = f.children.filter((id) => seat.has(id)).map(centre);
      if (kids.length) c += Math.abs(mid - kids.reduce((s, x) => s + x, 0) / kids.length) / BOX_W;
    }
    const xs = [...seat.values()].map((s) => s.x);
    return c + (Math.max(...xs) - Math.min(...xs)) / BOX_W * 0.05;
  }

  // Branches joined by marriage form a group, ordered as a whole. A small
  // group tries every order; a large one adds branches one at a time, each in
  // the position that costs least.
  const groups = [];
  const seen = new Set();
  for (const start of branches.values()) {
    if (seen.has(start.key)) continue;
    const group = [];
    const queue = [start];
    seen.add(start.key);
    while (queue.length) {
      const b = queue.shift();
      group.push(b);
      for (const [a, m] of across) {
        const other = branch.get(a) === b.key ? branch.get(m) : (branch.get(m) === b.key ? branch.get(a) : null);
        if (other && !seen.has(other)) {
          seen.add(other);
          queue.push(branches.get(other));
        }
      }
    }
    groups.push(group);
  }

  function bestOrder(group) {
    // While branches are added one at a time, an order holds only some of
    // the group, so only marriages between branches already in it count.
    const tryOrder = (order) => {
      const keys = new Set(order.map((b) => b.key));
      const links = across.filter(([a, m]) => keys.has(branch.get(a)) && keys.has(branch.get(m)));
      return cost(arrange(order), links);
    };
    if (group.length <= SEARCH_LIMIT) {
      let best = null;
      let bestCost = Infinity;
      const permute = (done, rest) => {
        if (!rest.length) {
          if (done[0].key > done[done.length - 1].key) return; // the mirror image costs the same
          const c = tryOrder(done);
          if (c < bestCost) { bestCost = c; best = done; }
          return;
        }
        rest.forEach((b, i) => permute([...done, b], [...rest.slice(0, i), ...rest.slice(i + 1)]));
      };
      if (group.length === 1) return group;
      permute([], group);
      return best;
    }
    const rest = [...group].sort((x, y) => y.size - x.size);
    let order = [rest.shift()];
    while (rest.length) {
      const inOrder = new Set(order.map((b) => b.key));
      const ties = (b) => across.filter(([a, m]) => (branch.get(a) === b.key && inOrder.has(branch.get(m)))
        || (branch.get(m) === b.key && inOrder.has(branch.get(a)))).length;
      rest.sort((x, y) => ties(y) - ties(x));
      const next = rest.shift();
      let bestCost = Infinity;
      let bestTry = null;
      for (let i = 0; i <= order.length; i++) {
        const attempt = [...order.slice(0, i), next, ...order.slice(i)];
        const c = tryOrder(attempt);
        if (c < bestCost) { bestCost = c; bestTry = attempt; }
      }
      order = bestTry;
    }
    return order;
  }

  // Unrelated groups sit side by side, the biggest first so the chart opens
  // on the main family.
  groups.sort((x, y) => y.reduce((s, b) => s + b.size, 0) - x.reduce((s, b) => s + b.size, 0));
  const depths = [...new Set(units.map((u) => u.level))].sort((a, b) => a - b);
  const topOf = (level) => depths.indexOf(level) * (BOX_H + ROW_GAP);
  const box = new Map();
  let cursor = 0;
  for (const group of groups) {
    const seat = arrange(bestOrder(group));
    const xs = [...seat.values()].map((s) => s.x);
    const left = Math.min(...xs);
    for (const [id, s] of seat) {
      box.set(id, { id, x: s.x - left + cursor, y: topOf(s.level), w: BOX_W, h: BOX_H });
    }
    cursor += Math.max(...xs) + BOX_W - left + GROUP_GAP;
  }
  return { box, families };
}

/* ---------- drawing ---------- */

function centre(b) {
  return b.x + b.w / 2;
}

// Families whose sibling bars would overlap in the same gap get their own
// heights (lanes). On one shared height two families' bars merged into one
// line, and a child read as belonging to the wrong parents.
const LANE_STEP = 14;
const LANE_ROOM = ROW_GAP - STUB - SIB_LIFT - 8; // space above the lowest lane
// Two bars on one height need this much air between them, or the eye joins
// them into one line.
const LANE_CLEAR = GAP_X * 2;

function assignLanes(runs) {
  // shortest bars nearest their children, long ones above them
  const lanes = [];
  for (const run of [...runs].sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))) {
    let lane = lanes.findIndex((taken) => taken.every((t) => run.lo > t.hi + LANE_CLEAR || run.hi < t.lo - LANE_CLEAR));
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push(run);
    run.lane = lane;
  }
  const step = lanes.length > 1 ? Math.min(LANE_STEP, LANE_ROOM / (lanes.length - 1)) : 0;
  for (const run of runs) run.sibY = run.childTop - SIB_LIFT - run.lane * step;
}

// Couple bars in the same gap that would overlap get their own heights too:
// the shortest nearest the parents, a long bar across other families lowest.
const BAR_STEP = 9;

function assignBarLanes(runs) {
  const lanes = [];
  for (const run of [...runs].sort((a, b) => (a.barHi - a.barLo) - (b.barHi - b.barLo))) {
    let lane = lanes.findIndex((taken) => taken.every((t) => run.barLo > t.barHi + LANE_CLEAR || run.barHi < t.barLo - LANE_CLEAR));
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push(run);
    run.barLane = lane;
  }
  const step = lanes.length > 1 ? Math.min(BAR_STEP, (STUB - 8) / (lanes.length - 1)) : 0;
  for (const run of runs) run.barY = run.parentBottom + STUB - (lanes.length - 1 - run.barLane) * step;
}

// One entry per family: `stubs` are the lines from the parents to their
// couple bar, `links` the rest, down to the children. All stubs are drawn
// first and all links over them. Each family's links sit on a halo in the
// background colour, so a line crossing another, or crossing someone else's
// couple bar, shows a small gap and never reads as a join. The halo starts a
// little below the family's own bar so it does not nick it.
function connectors(box, families, apart) {
  const out = [];
  const runs = [];
  for (const f of families) {
    const pb = f.parents.map((id) => box.get(id)).filter(Boolean);
    const cb = f.children.map((id) => box.get(id)).filter(Boolean);
    if (!pb.length || !cb.length) continue;
    const xs = pb.map(centre);
    const junction = (Math.min(...xs) + Math.max(...xs)) / 2;
    // The sibling bar has to reach the junction as well as the children.
    // An only child rarely sits directly under its parents, and without this
    // the drop line and the child's riser never met.
    const kidXs = cb.map(centre);
    runs.push({
      pb, cb, junction,
      parentBottom: Math.max(...pb.map((b) => b.y + b.h)),
      barLo: Math.min(...xs),
      barHi: Math.max(...xs),
      childTop: Math.min(...cb.map((b) => b.y)),
      lo: Math.min(junction, ...kidXs),
      hi: Math.max(junction, ...kidXs),
    });
  }

  const group = (key) => {
    const by = new Map();
    for (const run of runs) {
      if (!by.has(run[key])) by.set(run[key], []);
      by.get(run[key]).push(run);
    }
    return by.values();
  };
  // Only couples have a bar; a lone parent's line runs straight down. A
  // marriage with no children whose partners sit apart runs at couple-bar
  // height too, so it shares the lanes and never lies on another bar.
  for (const run of runs) run.barY = run.parentBottom + STUB;
  const byBottom = new Map();
  for (const run of [...runs.filter((r) => r.pb.length > 1), ...apart]) {
    if (!byBottom.has(run.parentBottom)) byBottom.set(run.parentBottom, []);
    byBottom.get(run.parentBottom).push(run);
  }
  for (const row of byBottom.values()) assignBarLanes(row);
  for (const row of group('childTop')) assignLanes(row);

  for (const { pb, cb, junction, barY, barLo, barHi, sibY, lo, hi } of runs) {
    // stub down from each parent, joined by a bar when there are two of them
    const stubs = pb.map((b) => `M ${centre(b)} ${b.y + b.h} L ${centre(b)} ${barY}`);
    if (pb.length > 1) stubs.push(`M ${barLo} ${barY} L ${barHi} ${barY}`);
    const bus = [];
    if (hi - lo > 0.5) bus.push(`M ${lo} ${sibY} L ${hi} ${sibY}`);
    for (const b of cb) bus.push(`M ${centre(b)} ${sibY} L ${centre(b)} ${b.y}`);
    out.push({
      stubs: stubs.join(' '),
      links: [`M ${junction} ${barY} L ${junction} ${sibY}`, ...bus].join(' '),
      halo: [`M ${junction} ${barY + 3} L ${junction} ${sibY}`, ...bus].join(' '),
    });
  }
  return out;
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

// Marriages with no children. Neighbours get a straight bar between their
// boxes. Partners further apart are returned in `apart`: their line drops
// below both boxes and runs across, at a height the couple-bar lanes pick.
function childlessMarriages(box, marriages, families) {
  const withKids = new Set(families.map((f) => [...f.parents].sort().join('+')));
  const near = [];
  const apart = [];
  for (const m of marriages) {
    if (withKids.has([m.a, m.b].sort().join('+'))) continue;
    const a = box.get(m.a);
    const b = box.get(m.b);
    if (!a || !b) continue;
    const ex = m.status === 'divorced';
    // Side by side, with nobody between: a straight bar, even across the gap
    // between two branches.
    const neighbours = a.y === b.y && ![...box.values()].some((o) => o !== a && o !== b
      && o.y === a.y && o.x > Math.min(a.x, b.x) && o.x < Math.max(a.x, b.x));
    if (neighbours) {
      const y = a.y + BOX_H / 2;
      const gapL = Math.min(a.x + a.w, b.x + b.w);
      const gapR = Math.max(a.x, b.x);
      near.push({ d: `M ${Math.min(gapL, gapR)} ${y} L ${Math.max(gapL, gapR)} ${y}`, ex, m });
      continue;
    }
    apart.push({
      m, ex, a, b,
      parentBottom: Math.max(a.y + a.h, b.y + b.h),
      barLo: Math.min(centre(a), centre(b)),
      barHi: Math.max(centre(a), centre(b)),
    });
  }
  return { near, apart };
}

// The far-apart line, once the lanes have set its height.
function apartPath({ a, b, barY }) {
  return `M ${centre(a)} ${a.y + a.h} L ${centre(a)} ${barY} L ${centre(b)} ${barY} L ${centre(b)} ${b.y + b.h}`;
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/* ---------- public entry ---------- */

// Draws the whole chart into `host`. `opts` supplies the data and the small
// bits of app state the chart needs: which person is focused or selected,
// how to label someone, and what to do on a click. `opts.view`, the pan and
// zoom from the chart this one replaces, keeps the view where it was;
// without it the chart frames everyone.
function draw(host, opts) {
  const { people, marriages, nameOf, labelOf, datesOf, deceasedOf, placeOf, noteOf, labels, focusId, selectedId, onPick } = opts;
  host.textContent = '';
  if (!people.length) return null;

  const { box, families } = layout(people, marriages, generations(people, marriages));
  // Set while the pointer is being dragged across the canvas, so the click
  // that ends a drag does not also open whichever box it landed on.
  let dragMoved = false;
  const svg = el('svg', { class: 'chart-svg' });
  const root = el('g');
  svg.appendChild(root);

  const wires = el('g', { class: 'chart-wires' });
  const { near, apart } = childlessMarriages(box, marriages, families);
  const wireList = connectors(box, families, apart);
  for (const wire of wireList) wires.appendChild(el('path', { d: wire.stubs }));
  for (const wire of wireList) {
    wires.appendChild(el('path', { class: 'chart-wire-halo', d: wire.halo }));
    wires.appendChild(el('path', { d: wire.links }));
  }
  root.appendChild(wires);

  // Drawn over the wires. A far-apart marriage line sits on a halo too, so
  // the lines it crosses show a gap instead of seeming to join it.
  const bars = el('g', { class: 'chart-bars' });
  const addBar = (d, bar, halo) => {
    if (halo) bars.appendChild(el('path', { class: 'chart-wire-halo', d }));
    const path = el('path', { d, class: bar.ex ? 'chart-bar ex' : 'chart-bar' });
    if (labels) {
      const tip = el('title');
      tip.textContent = marriageLabel(bar.m, labels);
      path.appendChild(tip);
    }
    bars.appendChild(path);
  };
  for (const bar of near) addBar(bar.d, bar, false);
  for (const bar of apart) addBar(apartPath(bar), bar, true);
  root.appendChild(bars);

  const boxes = el('g');
  for (const p of people) {
    const b = box.get(p.id);
    if (!b) continue;
    const g = el('g', { class: 'chart-node', 'data-id': p.id });
    if (p.id === focusId) g.classList.add('is-focus');
    if (p.id === selectedId) g.classList.add('is-selected');
    if (deceasedOf(p)) g.classList.add('is-dead');

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

  // A resize keeps the zoom and the point in the middle of the view. The
  // first real size of a chart drawn while its host had none frames everyone.
  let size = { w: host.clientWidth, h: host.clientHeight };
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!size.w || !size.h) {
      size = { w, h };
      fit();
      return;
    }
    view.x += (w - size.w) / 2;
    view.y += (h - size.h) / 2;
    size = { w, h };
    apply();
  }

  if (opts.view) {
    Object.assign(view, opts.view);
    apply();
  } else {
    fit();
  }
  return {
    fit,
    resize,
    view: () => ({ ...view }),
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

// A bug in the layout must not leave a blank chart with no clue why. Say so
// in the chart area and keep the error in the console for whoever fixes it.
function render(host, opts) {
  try {
    return draw(host, opts);
  } catch (err) {
    console.error(err);
    host.textContent = '';
    const msg = document.createElement('div');
    msg.className = 'chart-failed';
    msg.textContent = (opts.labels && opts.labels.failed) || 'The chart could not be drawn.';
    host.appendChild(msg);
    return null;
  }
}

// layout and generations are exported for tests/chart.test.mjs
window.FamilyChart = { render, layout, generations };

})();
