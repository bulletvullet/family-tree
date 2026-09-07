/* ============================================================
   Family tree: public tree-only page.
   Data: a static people.json snapshot sitting next to index.html.
   Graph: 3d-force-graph + three-spritetext (same as the main app).
   Interface language: i18n.js, the same file the main app uses.
   ============================================================ */

'use strict';

const { t } = window.I18n;

let people = [];
let marriages = [];

const VIEW_KEY = 'familyTree.view.v1';           // 'graph' or 'tree'
// 'graph' lets the physics place everyone freely. 'tree' pins each person to
// the height of their generation, so the layout reads like a family tree.
let viewMode = (() => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'graph';
  } catch {
    return 'graph';
  }
})();

/* ---------- helpers ---------- */
function byId(id) {
  return people.find((p) => p.id === id) || null;
}

function fullName(p) {
  const last = p.maidenName
    ? (p.lastName ? `${p.lastName} (${p.maidenName})` : `(${p.maidenName})`)
    : p.lastName;
  return [last, p.firstName, p.middleName].filter(Boolean).join(' ');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function ellipsize(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function lifeDates(p) {
  const b = p.birthDate || '';
  const d = p.deathDate || '';
  if (b && d) return `${b} — ${d}`;
  if (b) return `${t('life.born')} ${b}`;
  if (d) return `† ${d}`;
  return '';
}

/* ============================================================
   Tree: a 3D force graph (node repulsion plus springs on the edges,
   orbit controls). Edges run parent -> child.
   ============================================================ */
const COLOR_ALIVE = '#7b8cf0';
const COLOR_DEAD = '#a3947a';
const COLOR_FOCUS = '#3f8f4f';
const COLOR_EDGE = '#49506b';
const COLOR_EDGE_HI = '#c3cbf7';
const COLOR_SPOUSE = '#b98ac4';
const COLOR_SPOUSE_EX = '#6d6275';

let Graph = null;
let chart = null;   // handle returned by the SVG chart, null while the graph is up
let fitRequested = true;
const highlightedLinks = new Set();
const highlightedNodes = new Set();

// Generation of every person: 0 with no parents in the tree, otherwise one
// past the deepest parent. Spouses are pulled onto the same generation so a
// couple sits side by side even when one of them married in from nowhere.
function generationLevels() {
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

function graphDataFromPeople() {
  const ids = new Set(people.map((p) => p.id));
  const nodes = people.map((p) => ({
    id: p.id,
    name: fullName(p),
    dates: lifeDates(p),
    place: p.birthPlace || '',
    notes: p.notes || '',
    color: p.deathDate ? COLOR_DEAD : COLOR_ALIVE,
    deceased: !!p.deathDate,
    focus: !!p.focus,
  }));
  const links = [];
  for (const p of people) {
    for (const pid of p.parents) {
      if (ids.has(pid)) links.push({ source: pid, target: p.id });
    }
  }
  for (const m of marriages) {
    if (ids.has(m.a) && ids.has(m.b)) {
      links.push({ source: m.a, target: m.b, spouse: true, ex: m.status === 'divorced' });
    }
  }
  return { nodes, links };
}

// node label: full name above the sphere, life dates below it
function makeNodeObject(n) {
  const group = new THREE.Group();
  const name = new SpriteText(n.name);
  name.color = n.deceased ? '#d8cdbb' : '#e7e9f2';
  name.textHeight = 6.5;
  name.backgroundColor = 'rgba(23, 26, 36, 0.72)';
  name.padding = 2.5;
  name.borderRadius = 3;
  name.position.y = 13;
  group.add(name);
  if (n.dates) {
    const dates = new SpriteText(n.dates);
    dates.color = n.deceased ? '#a3947a' : '#95a3f5';
    dates.textHeight = 4.6;
    dates.position.y = -12;
    group.add(dates);
  }
  return group;
}

function linkEndId(l, end) {
  const v = l[end];
  return typeof v === 'object' ? v.id : v;
}

function initTree() {
  Graph = ForceGraph3D()(document.getElementById('tree3d'))
    .backgroundColor('#171a24')
    .showNavInfo(false)
    // nodes
    .nodeRelSize(4)
    .nodeVal(() => 3)
    .nodeColor((n) => {
      if (highlightedNodes.has(n.id)) return '#ffffff';
      return n.focus ? COLOR_FOCUS : n.color;
    })
    .nodeOpacity(0.95)
    .nodeResolution(24)
    .nodeLabel((n) => {
      const head = [n.name, n.dates, n.place].filter(Boolean).join(' · ');
      // the label is rendered as HTML, so the note's own line breaks need turning
      // into <br> or they collapse into one run-on line
      const note = escapeHtml(ellipsize(n.notes, 140)).replace(/\n/g, '<br>');
      return n.notes ? `${head}<br>${note}` : head;
    })
    .nodeThreeObjectExtend(true)
    .nodeThreeObject(makeNodeObject)
    // edges
    .linkColor((l) => {
      if (highlightedLinks.has(l)) return COLOR_EDGE_HI;
      if (l.spouse) return l.ex ? COLOR_SPOUSE_EX : COLOR_SPOUSE;
      return COLOR_EDGE;
    })
    .linkWidth((l) => (highlightedLinks.has(l) ? 5.2 : (l.spouse ? 2.6 : 1.8)))
    .linkOpacity(0.4)
    // parent to child points somewhere; a marriage has no direction
    .linkDirectionalArrowLength((l) => (l.spouse ? 0 : 3))
    .linkDirectionalArrowRelPos(1)
    .linkDirectionalParticles((l) => (highlightedLinks.has(l) ? 3 : 0))
    .linkDirectionalParticleWidth(1.6)
    // interaction
    .onNodeHover(handleNodeHover)
    .onNodeClick(handleNodeClick)
    .onEngineStop(() => {
      if (fitRequested) {
        fitRequested = false;
        fitCamera(0);
      }
    });

  Graph.d3VelocityDecay(0.22);

  sizeTree();
}

new ResizeObserver(sizeTree).observe(document.getElementById('treeViewport'));

function sizeTree() {
  if (chart) chart.fit();
  if (!Graph) return;
  const vp = document.getElementById('treeViewport');
  Graph.width(vp.clientWidth).height(vp.clientHeight);
}

function handleNodeHover(node) {
  highlightedLinks.clear();
  highlightedNodes.clear();
  if (node) {
    highlightedNodes.add(node.id);
    for (const l of Graph.graphData().links) {
      if (linkEndId(l, 'source') === node.id || linkEndId(l, 'target') === node.id) {
        highlightedLinks.add(l);
        highlightedNodes.add(linkEndId(l, 'source'));
        highlightedNodes.add(linkEndId(l, 'target'));
      }
    }
  }
  document.getElementById('tree3d').style.cursor = node ? 'pointer' : 'default';
  Graph.refresh();
}

function handleNodeClick(node) {
  // the camera flies over to the node
  const dist = 140;
  const hyp = Math.hypot(node.x, node.y, node.z) || 1;
  const r = 1 + dist / hyp;
  Graph.cameraPosition(
    { x: node.x * r, y: node.y * r, z: node.z * r },
    { x: node.x, y: node.y, z: node.z },
    1200
  );
}

// fit the graph into view using the simulation bounding box
function fitCamera(ms = 800) {
  if (!Graph) return;
  const nodes = Graph.graphData().nodes.filter((n) => n.x !== undefined);
  if (!nodes.length) return;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const dist = Math.min(1200, Math.max(220, size * 1.5 + 120));
  Graph.cameraPosition({ x: cx, y: cy, z: cz + dist }, { x: cx, y: cy, z: cz }, ms);
}

function zoomBy(factor) {
  if (!Graph) return;
  const look = Graph.controls().target;
  const pos = Graph.camera().position;
  Graph.cameraPosition(
    {
      x: look.x + (pos.x - look.x) * factor,
      y: look.y + (pos.y - look.y) * factor,
      z: look.z + (pos.z - look.z) * factor,
    },
    look,
    300
  );
}

document.getElementById('zoomIn').addEventListener('click', () => (chart ? chart.zoomIn() : zoomBy(0.75)));
document.getElementById('zoomOut').addEventListener('click', () => (chart ? chart.zoomOut() : zoomBy(1.33)));
document.getElementById('fitView').addEventListener('click', () => (chart ? chart.fit() : fitCamera()));

// The classic chart: boxes in generation rows joined by right-angle lines.
function renderChart() {
  const focused = people.find((p) => p.focus) || null;
  chart = FamilyChart.render(document.getElementById('treeChart'), {
    people,
    marriages,
    levels: generationLevels(),
    nameOf: fullName,
    labelOf: (p) => ({
      surname: p.maidenName
        ? (p.lastName ? `${p.lastName} (${p.maidenName})` : `(${p.maidenName})`)
        : p.lastName,
      given: [p.firstName, p.middleName].filter(Boolean).join(' '),
    }),
    datesOf: lifeDates,
    placeOf: (p) => p.birthPlace || '',
    noteOf: (p) => p.notes || '',
    labels: { marriage: t('marriage.title'), divorced: t('chip.exSpouse') },
    focusId: focused ? focused.id : null,
    selectedId: null,
    onPick: (id) => {
      for (const g of document.querySelectorAll('.chart-node')) {
        g.classList.toggle('is-selected', g.dataset.id === id);
      }
    },
  });
}

function renderTree() {
  document.getElementById('treeEmpty').classList.toggle('hidden', people.length > 0);
  const showChart = viewMode === 'tree';
  document.getElementById('tree3d').classList.toggle('hidden', showChart);
  document.getElementById('treeChart').classList.toggle('hidden', !showChart);
  if (showChart) {
    renderChart();
    return;
  }
  chart = null;
  document.getElementById('treeChart').textContent = '';
  if (!Graph) initTree();
  sizeTree(); // the container had no width while the chart was showing
  Graph.graphData(graphDataFromPeople());
  // physics: charge adapts to the node count
  Graph.d3Force('charge').strength(-260 * Math.sqrt(Math.max(1, people.length) / 100));
  Graph.d3Force('link').distance(110);
}

// View switch. Like the language button, it shows what you get by clicking:
// 'Древо' while the free graph layout is on screen.
function renderViewButton() {
  const goingToTree = viewMode !== 'tree';
  const btn = document.getElementById('viewToggle');
  btn.textContent = t(goingToTree ? 'tree.toTree' : 'tree.toGraph');
  btn.title = t(goingToTree ? 'tree.toTreeTitle' : 'tree.toGraphTitle');
}

document.getElementById('viewToggle').addEventListener('click', () => {
  viewMode = viewMode === 'tree' ? 'graph' : 'tree';
  try {
    localStorage.setItem(VIEW_KEY, viewMode);
  } catch {
    // storage disabled: the choice just will not survive a reload
  }
  renderViewButton();
  fitRequested = true; // the layout changes shape, so frame it again
  renderTree();
});

// Language switch. The button shows the language it switches to,
// so 'EN' while the interface is Russian.
function renderLangButton() {
  const other = I18n.getLang() === 'ru' ? 'en' : 'ru';
  document.getElementById('langToggle').textContent = other.toUpperCase();
}

document.getElementById('langToggle').addEventListener('click', () => I18n.toggleLang());

// life dates sit under every node, so the graph is rebuilt on a language change
I18n.onLangChange(() => {
  renderLangButton();
  renderViewButton();
  renderTree();
});

async function boot() {
  // tree.json carries people and marriages. An older deployment only has
  // people.json, a bare array, so that shape is still accepted.
  try {
    const r = await fetch('tree.json');
    if (!r.ok) throw new Error('no tree.json');
    const doc = await r.json();
    people = Array.isArray(doc.people) ? doc.people : [];
    marriages = Array.isArray(doc.marriages) ? doc.marriages : [];
  } catch {
    try {
      const r = await fetch('people.json');
      const doc = await r.json();
      people = Array.isArray(doc) ? doc : (doc.people || []);
      marriages = Array.isArray(doc.marriages) ? doc.marriages : [];
    } catch {
      people = [];
      marriages = [];
    }
  }
  I18n.applyStatic();
  renderLangButton();
  renderViewButton();
  renderTree();
}

boot();
