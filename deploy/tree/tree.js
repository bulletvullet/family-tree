/* ============================================================
   Семейное древо — публичная страница «только дерево».
   Данные: статический снимок people.json (рядом с index.html).
   Граф: 3d-force-graph + three-spritetext (как в основном приложении).
   ============================================================ */

'use strict';

let people = [];

/* ---------- вспомогательные ---------- */
function byId(id) {
  return people.find((p) => p.id === id) || null;
}

function fullName(p) {
  const last = p.maidenName
    ? (p.lastName ? `${p.lastName} (${p.maidenName})` : `(${p.maidenName})`)
    : p.lastName;
  return [last, p.firstName, p.middleName].filter(Boolean).join(' ');
}

function lifeDates(p) {
  const b = p.birthDate || '';
  const d = p.deathDate || '';
  if (b && d) return `${b} — ${d}`;
  if (b) return `р. ${b}`;
  if (d) return `† ${d}`;
  return '';
}

/* ============================================================
   Дерево: 3D force-граф (отталкивание нод + пружины на рёбрах,
   orbit-управление). Рёбра — родитель→ребёнок.
   ============================================================ */
const COLOR_ALIVE = '#7b8cf0';
const COLOR_DEAD = '#a3947a';
const COLOR_FOCUS = '#3f8f4f';
const COLOR_EDGE = '#49506b';
const COLOR_EDGE_HI = '#c3cbf7';

let Graph = null;
let fitRequested = true;
const highlightedLinks = new Set();
const highlightedNodes = new Set();

function graphDataFromPeople() {
  const ids = new Set(people.map((p) => p.id));
  const nodes = people.map((p) => ({
    id: p.id,
    name: fullName(p),
    dates: lifeDates(p),
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
  return { nodes, links };
}

// подпись ноды: ФИО над сферой, даты жизни под ней
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
    // ноды
    .nodeRelSize(4)
    .nodeVal(() => 3)
    .nodeColor((n) => {
      if (highlightedNodes.has(n.id)) return '#ffffff';
      return n.focus ? COLOR_FOCUS : n.color;
    })
    .nodeOpacity(0.95)
    .nodeResolution(24)
    .nodeLabel((n) => `${n.name}${n.dates ? ' · ' + n.dates : ''}`)
    .nodeThreeObjectExtend(true)
    .nodeThreeObject(makeNodeObject)
    // рёбра
    .linkColor((l) => (highlightedLinks.has(l) ? COLOR_EDGE_HI : COLOR_EDGE))
    .linkWidth((l) => (highlightedLinks.has(l) ? 5.2 : 1.8))
    .linkOpacity(0.4)
    .linkDirectionalArrowLength(3)
    .linkDirectionalArrowRelPos(1)
    .linkDirectionalParticles((l) => (highlightedLinks.has(l) ? 3 : 0))
    .linkDirectionalParticleWidth(1.6)
    // интерактив
    .onNodeHover(handleNodeHover)
    .onNodeClick(handleNodeClick)
    .onEngineStop(() => {
      if (fitRequested) {
        fitRequested = false;
        fitCamera(0);
      }
    });

  Graph.d3VelocityDecay(0.22);

  const treeViewport = document.getElementById('treeViewport');
  new ResizeObserver(sizeTree).observe(treeViewport);
  sizeTree();
}

function sizeTree() {
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
  // камера подлетает к ноде
  const dist = 140;
  const hyp = Math.hypot(node.x, node.y, node.z) || 1;
  const r = 1 + dist / hyp;
  Graph.cameraPosition(
    { x: node.x * r, y: node.y * r, z: node.z * r },
    { x: node.x, y: node.y, z: node.z },
    1200
  );
}

// вписать граф в кадр по bbox симуляции
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

document.getElementById('zoomIn').addEventListener('click', () => zoomBy(0.75));
document.getElementById('zoomOut').addEventListener('click', () => zoomBy(1.33));
document.getElementById('fitView').addEventListener('click', () => fitCamera());

function renderTree() {
  document.getElementById('treeEmpty').classList.toggle('hidden', people.length > 0);
  if (!Graph) initTree();
  Graph.graphData(graphDataFromPeople());
  // физика: charge адаптируется к числу нод
  Graph.d3Force('charge').strength(-260 * Math.sqrt(Math.max(1, people.length) / 100));
  Graph.d3Force('link').distance(110);
}

async function boot() {
  try {
    const r = await fetch('people.json');
    people = await r.json();
  } catch {
    people = [];
  }
  renderTree();
}

boot();
