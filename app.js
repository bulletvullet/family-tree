/* ============================================================
   Family tree: application logic
   Data: localStorage, key familyTree.people.v1
   Person: { id, lastName, maidenName, firstName, middleName,
             birthDate, deathDate, gender, focus, parents: [id, ...] }
   Dates are strings 'YYYY' | 'MM-YYYY' | 'DD-MM-YYYY' (may be partial)

   Interface text and kinship words live in i18n.js. Kinship is never
   built as text here: this file produces descriptors and I18n.renderTerm
   turns them into words in the language the user picked.
   ============================================================ */

'use strict';

const { t, renderTerm } = window.I18n;

const STORAGE_KEY = 'familyTree.tree.v2';        // backup copy in the browser
const LEGACY_KEY = 'familyTree.people.v1';       // v1 held a bare array of people
const VIEW_KEY = 'familyTree.view.v1';           // 'graph' or 'tree'
// Must match SCHEMA in server.py. A server on older code answers requests
// normally and silently discards fields it does not know, so a mismatch is
// treated as a fault rather than shrugged off.
const NEEDS_SCHEMA = 1;
const MIGRATED_KEY = 'familyTree.migrated.v1';   // flag: migrated to SQLite
// Talk to the server that served this page, so an instance started on another
// port with its own database is self-contained. Only a page opened straight
// from disk (file://) has no usable origin and falls back to the default port.
const API_URL = location.protocol.startsWith('http')
  ? `${location.origin}/api/tree`
  : 'http://localhost:8791/api/tree';

/* ---------- state ---------- */
let people = [];
// One entry per marriage: { id, a, b, status } with status 'married' | 'divorced'.
// The pair is unordered, and a person may appear in several of them.
let marriages = [];
// 'graph' lets the physics place everyone freely. 'tree' pins each person to
// the height of their generation, so the layout reads like a family tree.
let viewMode = (() => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'graph';
  } catch {
    return 'graph';
  }
})();
let useServer = false;
let serverStale = false;   // server answering, but on older code
let editingId = null;
let openMarriageId = null;   // marriage whose details are on screen
let sortState = { key: 'lastName', dir: 1 }; // dir: 1 = A-Z, -1 = Z-A
let selectedId = null;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const form = $('personForm');
const lastNameEl = $('lastName');
const maidenNameEl = $('maidenName');
const firstNameEl = $('firstName');
const middleNameEl = $('middleName');
const birthPlaceEl = $('birthPlace');
const notesEl = $('notes');
const birthDayEl = $('birthDay');
const birthMonthEl = $('birthMonth');
const birthYearEl = $('birthYear');
const deathDayEl = $('deathDay');
const deathMonthEl = $('deathMonth');
const deathYearEl = $('deathYear');
const relativeSelect = $('relativeSelect');
const relationSelect = $('relationSelect');
const relativeSelect2 = $('relativeSelect2');
const relationSelect2 = $('relationSelect2');
const formError = $('formError');
const formTitle = $('formTitle');
const submitBtn = $('submitBtn');
const cancelBtn = $('cancelBtn');
const focusToggle = $('focusToggle');
const relativesBox = $('relativesBox');
const relativesChips = $('relativesChips');
const marriageBox = $('marriageBox');
const marriageWho = $('marriageWho');
const marDayEl = $('marDay');
const marMonthEl = $('marMonth');
const marYearEl = $('marYear');
const marPlaceEl = $('marPlace');
const divDayEl = $('divDay');
const divMonthEl = $('divMonth');
const divYearEl = $('divYear');
const tbody = $('peopleTbody');
const peopleCount = $('peopleCount');
const tree3d = $('tree3d');
const treeEmpty = $('treeEmpty');
const treeViewport = $('treeViewport');
const serverWarning = $('serverWarning');
const langToggle = $('langToggle');
const viewToggle = $('viewToggle');
const treeChart = $('treeChart');

/* ============================================================
   Storage: SQLite on the local server (server.py) is the primary store,
   with a backup copy in the browser localStorage.
   ============================================================ */
// Reads the browser backup. v1 stored a bare array of people with no
// marriages, so an older backup is accepted and lifted into the new shape.
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const doc = JSON.parse(raw);
      if (doc && Array.isArray(doc.people)) {
        return { people: doc.people, marriages: Array.isArray(doc.marriages) ? doc.marriages : [] };
      }
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    if (Array.isArray(legacy)) return { people: legacy, marriages: [] };
  } catch {
    // unreadable backup is the same as no backup
  }
  return { people: [], marriages: [] };
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ people, marriages }));
}

// null when all is well, otherwise which fault to report.
let banner = null;

const BANNERS = {
  offline: { key: 'server.warning', cmd: 'start.command' },
  stale: { key: 'server.stale', cmd: 'make run' },
};

function renderBanner() {
  if (!banner) {
    serverWarning.classList.add('hidden');
    return;
  }
  // the message names a command inside <code>, so build it from nodes
  const { key, cmd } = BANNERS[banner];
  const [before, after] = t(key).split('{cmd}');
  const code = document.createElement('code');
  code.textContent = cmd;
  serverWarning.textContent = '';
  serverWarning.append(before || '', code, after || '');
  serverWarning.classList.remove('hidden');
}

function setBanner(next) {
  banner = next;
  renderBanner();
}

async function loadTree() {
  try {
    const r = await fetch(API_URL);
    if (!r.ok) throw new Error('bad status');
    const doc = await r.json();
    useServer = true;
    // A server with no schema at all predates the field, so it is older too.
    serverStale = (doc.schema || 0) < NEEDS_SCHEMA;
    setBanner(serverStale ? 'stale' : null);
    return {
      people: Array.isArray(doc.people) ? doc.people : [],
      marriages: Array.isArray(doc.marriages) ? doc.marriages : [],
    };
  } catch {
    useServer = false;
    setBanner('offline');
    return loadLocal(); // fallback so the data is not lost
  }
}

async function saveToServer() {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ people, marriages }),
  });
  if (!r.ok) throw new Error('save failed');
}

function save() {
  saveLocal(); // browser backup, always, and it keeps every field
  saveToServer()
    .then(() => {
      useServer = true;
      // A stale server accepts the write, so success here says nothing about
      // whether the newer fields survived. Keep warning.
      setBanner(serverStale ? 'stale' : null);
    })
    .catch(() => { useServer = false; setBanner('offline'); });
}

// Startup load plus a one-time localStorage -> SQLite migration
async function boot() {
  ({ people, marriages } = await loadTree());
  if (useServer && people.length === 0 && !localStorage.getItem(MIGRATED_KEY)) {
    const legacy = loadLocal();
    if (legacy.people.length) {
      people = legacy.people;
      marriages = legacy.marriages;
      try {
        await saveToServer(); // move into SQLite without losing anything
      } catch {
        setBanner('offline');
      }
    }
    localStorage.setItem(MIGRATED_KEY, '1');
  }
  marriages = marriages.filter((m) => byId(m.a) && byId(m.b) && m.a !== m.b);
  // fill in gender where it is missing (inferred from patronymic or first name)
  let genderFilled = false;
  for (const p of people) {
    if (!p.gender) {
      p.gender = inferGender(p);
      if (p.gender) genderFilled = true;
    }
  }
  if (genderFilled) save();
  I18n.applyStatic();
  renderLangButton();
  renderViewButton();
  renderFormChrome();
  renderAll();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function byId(id) {
  return people.find((p) => p.id === id) || null;
}

// Only one person can hold focus:
// setting it clears the flag on everyone else
function setFocus(id, on) {
  for (const p of people) p.focus = on && p.id === id;
}

/* ============================================================
   Dates: separate DD / MM / YYYY fields.
   Stored as a string: 'YYYY' | 'MM-YYYY' | 'DD-MM-YYYY'.
   Not every date is known exactly, a year or a month with a year is enough.
   ============================================================ */
// digits only in the date fields
for (const el of [birthDayEl, birthMonthEl, birthYearEl, deathDayEl, deathMonthEl, deathYearEl,
                  marDayEl, marMonthEl, marYearEl, divDayEl, divMonthEl, divYearEl]) {
  el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, ''); });
}

// Build a date string from the three fields.
// Returns '' (all empty) | a date string | undefined (invalid).
function composeDate(dEl, mEl, yEl) {
  const d = dEl.value.trim();
  const mo = mEl.value.trim();
  const y = yEl.value.trim();
  if (!d && !mo && !y) return '';
  if (!y) return undefined;              // year is required
  if (y.length !== 4) return undefined;
  if (d && !mo) return undefined;        // a day without a month is not allowed
  if (mo && (+mo < 1 || +mo > 12)) return undefined;
  let s = y;
  if (mo) s = mo.padStart(2, '0') + '-' + s;
  if (d) s = d.padStart(2, '0') + '-' + s;
  // calendar check (31-02 does not exist, for example)
  if (parseRuDate(s) === undefined) return undefined;
  return s;
}

// Fill the three fields from a 'YYYY' | 'MM-YYYY' | 'DD-MM-YYYY' string
function fillDateParts(dEl, mEl, yEl, s) {
  const parts = (s || '').split('-');
  yEl.value = parts.pop() || '';
  mEl.value = parts.pop() || '';
  dEl.value = parts.pop() || '';
}

// 'DD-MM-YYYY' | 'MM-YYYY' | 'YYYY' -> timestamp | null (empty) | undefined (invalid)
// a partial date counts from the start of the month or year (for sorting)
function parseRuDate(s) {
  s = (s || '').trim();
  if (!s) return null;
  const parts = s.split('-');
  let d = '01', mo = '01', y;
  if (parts.length === 1) {
    [y] = parts;
  } else if (parts.length === 2) {
    [mo, y] = parts;
  } else if (parts.length === 3) {
    [d, mo, y] = parts;
  } else {
    return undefined;
  }
  if (!/^\d{4}$/.test(y)) return undefined;
  if (parts.length > 1 && !/^\d{2}$/.test(mo)) return undefined;
  if (parts.length > 2 && !/^\d{2}$/.test(d)) return undefined;
  const dt = new Date(+y, +mo - 1, +d);
  if (dt.getFullYear() !== +y || dt.getMonth() !== +mo - 1 || dt.getDate() !== +d) return undefined;
  return dt.getTime();
}

/* ============================================================
   Parent-child links
   ============================================================ */
// Is `ancestorId` an ancestor of `personId` (walking up through parents)
function isAncestor(ancestorId, personId) {
  const seen = new Set();
  const stack = [personId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === ancestorId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const p = byId(cur);
    if (p) stack.push(...p.parents);
  }
  return false;
}

// Checks whether a link is allowed. Returns null if it is
// (or if it already exists, which makes it a no-op), otherwise the error text.
function canAddParent(child, parent) {
  if (child.id === parent.id) return t('err.selfParent');
  if (child.parents.includes(parent.id)) return null; // link already exists
  if (child.parents.length >= 2) {
    return t('err.twoParents', { name: fullName(child) });
  }
  if (isAncestor(child.id, parent.id)) {
    return t('err.cycle');
  }
  return null;
}

// Adds parent to child. Throws an Error carrying user-facing text.
function addParent(child, parent) {
  const err = canAddParent(child, parent);
  if (err) throw new Error(err);
  if (!child.parents.includes(parent.id)) child.parents.push(parent.id);
}

function removeParent(childId, parentId) {
  const child = byId(childId);
  if (!child) return;
  child.parents = child.parents.filter((id) => id !== parentId);
}

/* ---------- marriages ---------- */
// The pair is unordered, so every lookup has to check both columns.
function marriageBetween(x, y) {
  return marriages.find((m) => (m.a === x && m.b === y) || (m.a === y && m.b === x)) || null;
}

function marriagesOf(id) {
  return marriages.filter((m) => m.a === id || m.b === id);
}

function spouseIdIn(m, id) {
  return m.a === id ? m.b : m.a;
}

function addMarriage(x, y) {
  if (x === y) throw new Error(t('err.selfLink'));
  const existing = marriageBetween(x, y);
  if (existing) return existing;      // already married, nothing to do
  const m = { id: uid(), a: x, b: y, status: 'married' };
  marriages.push(m);
  return m;
}

function removeMarriage(id) {
  marriages = marriages.filter((m) => m.id !== id);
}

// Everyone this person is or was married to, plus anyone they share a child
// with. The inferred half keeps trees built before marriages existed working:
// a couple with children still reads as married without an explicit record.
function spouseLinks(id) {
  const out = [];
  const seen = new Set();
  for (const m of marriagesOf(id)) {
    const other = spouseIdIn(m, id);
    if (!byId(other) || seen.has(other)) continue;
    seen.add(other);
    out.push({ id: other, ex: m.status === 'divorced' });
  }
  for (const c of people) {
    if (!c.parents.includes(id)) continue;
    for (const pid of c.parents) {
      if (pid === id || seen.has(pid) || !byId(pid)) continue;
      seen.add(pid);
      out.push({ id: pid, ex: false });
    }
  }
  return out;
}

// Everyone sharing at least one parent. Not a stored link: it falls out of
// the parent lists, which is why the form shows siblings but cannot edit them.
function siblingsOf(id) {
  const me = byId(id);
  if (!me || !me.parents.length) return [];
  const mine = new Set(me.parents);
  return people
    .filter((q) => q.id !== id && q.parents.some((pid) => mine.has(pid)))
    .sort((a, b) => (parseRuDate(a.birthDate) ?? Infinity) - (parseRuDate(b.birthDate) ?? Infinity));
}

// Pairs of relative plus how they relate, taken from the form (empty ones skipped)
function formRelationPairs() {
  return [
    { otherId: relativeSelect.value, relType: relationSelect.value },
    { otherId: relativeSelect2.value, relType: relationSelect2.value },
  ].filter((r) => r.otherId);
}

// Applies several links to person atomically:
// if any link is not allowed, roll back the ones already added.
function applyRelations(person, pairs) {
  const applied = [];
  try {
    for (const { otherId, relType } of pairs) {
      if (otherId === person.id) throw new Error(t('err.selfLink'));
      const other = byId(otherId);
      if (!other) continue;
      if (relType === 'spouse') {
        if (!marriageBetween(person.id, other.id)) {
          const m = addMarriage(person.id, other.id);
          applied.push(['marriage', m.id]);
        }
        continue;
      }
      let child, parent;
      if (relType === 'father' || relType === 'mother') {
        child = person; parent = other; // the selected person is this person's parent
      } else {
        child = other; parent = person; // son/daughter: this person is the parent of the selected one
      }
      // father/son -> М, mother/daughter -> Ж
      other.gender = (relType === 'father' || relType === 'son') ? 'М' : 'Ж';
      const err = canAddParent(child, parent);
      if (err) throw new Error(err);
      if (!child.parents.includes(parent.id)) {
        child.parents.push(parent.id);
        applied.push([child, parent.id]);
      }
    }
  } catch (e) {
    for (const [what, ref] of applied) {
      if (what === 'marriage') removeMarriage(ref);
      else what.parents = what.parents.filter((id) => id !== ref);
    }
    throw e;
  }
}

/* ============================================================
   Helpers
   ============================================================ */
function fullName(p) {
  const last = p.maidenName
    ? (p.lastName ? `${p.lastName} (${p.maidenName})` : `(${p.maidenName})`)
    : p.lastName;
  return [last, p.firstName, p.middleName].filter(Boolean).join(' ');
}

// Gender inference: from the patronymic (-ич -> М, -на -> Ж).
// With no patronymic, from the first name (-а/-я -> Ж, otherwise М; -ь is unknown)
function inferGender(p) {
  const m = (p.middleName || '').trim().toLowerCase();
  if (m.endsWith('ич')) return 'М';
  if (m.endsWith('на')) return 'Ж';
  const f = (p.firstName || '').trim().toLowerCase();
  if (!f) return '';
  if (/[ая]$/.test(f)) return 'Ж';
  if (f.endsWith('ь')) return '';
  return 'М';
}

// Gender: the patronymic (-ич -> М, -на -> Ж) is the most reliable signal and wins.
// With no patronymic or an ambiguous one, use the stored value, then infer from the name
function genderOf(p) {
  const m = (p.middleName || '').trim().toLowerCase();
  if (m.endsWith('ич')) return 'М';
  if (m.endsWith('на')) return 'Ж';
  return p.gender || inferGender(p);
}

// 'М'/'Ж' are stored in the database; the table shows them in the current language
function genderLabel(p) {
  const g = genderOf(p);
  if (g === 'М') return t('gender.m');
  if (g === 'Ж') return t('gender.f');
  return '';
}

// generation distances to every ancestor of personId (BFS up through parents)
function ancestorDistances(id) {
  const dist = new Map();
  const queue = [[id, 0]];
  while (queue.length) {
    const [cur, d] = queue.shift();
    const p = byId(cur);
    if (!p) continue;
    for (const pid of p.parents) {
      if (!dist.has(pid)) {
        dist.set(pid, d + 1);
        queue.push([pid, d + 1]);
      }
    }
  }
  return dist;
}

// Blood relation of person to anchor: { rel, dist } | null.
// rel is a kinship descriptor for i18n.js, never a finished word.
// dist is the distance in generations (ancestor: g, descendant: h, collateral line: g+h).
// aAnc/pAnc are ancestor maps from ancestorDistances, passed in to avoid recomputing them.
function bloodInfo(anchor, person, aAnc, pAnc) {
  const fem = genderOf(person) === 'Ж';

  // person is a direct ancestor of anchor
  if (aAnc.has(person.id)) {
    const g = aAnc.get(person.id);
    return { rel: { k: 'anc', g, fem }, dist: g };
  }
  // person is a direct descendant of anchor
  if (pAnc.has(anchor.id)) {
    const h = pAnc.get(anchor.id);
    return { rel: { k: 'desc', h, fem }, dist: h };
  }
  // nearest common ancestor
  let best = null;
  for (const [id, g] of aAnc) {
    const h = pAnc.get(id);
    if (h === undefined) continue;
    if (!best || g + h < best.g + best.h) best = { g, h };
  }
  if (!best) return null;
  const { g, h } = best;
  let rel;
  if (g === 1 && h === 1) rel = { k: 'sib', fem };          // sibling
  else if (h === 1) rel = { k: 'pib', g, fem };             // aunt, great-aunt...
  else if (g === 1) rel = { k: 'nib', h, fem };             // niece, great-niece...
  else rel = { k: 'cous', g, h, fem };                      // cousins, possibly removed
  return { rel, dist: g + h };
}

// blood relation of person to the focus person ('' when they are not related)
function kinshipLabel(focus, person) {
  if (person.id === focus.id) return renderTerm({ k: 'me' });
  const info = bloodInfo(focus, person, ancestorDistances(focus.id), ancestorDistances(person.id));
  return info ? renderTerm(info.rel) : '';
}

// Close blood relations, matched on the descriptor rather than on a word.
// The exact in-law term depends on them: a wife's brother and a husband's
// brother are both a brother-in-law in English but not in Russian.
function isParent(x, fem) { return x.k === 'anc' && x.g === 1 && x.fem === fem; }
function isSibling(x, fem) { return x.k === 'sib' && x.fem === fem; }
function isChild(x, fem) { return x.k === 'desc' && x.h === 1 && x.fem === fem; }

// status via a spouse: X is the wife or husband of the person with status s.
// A former marriage skips the single-word terms, because 'бывшая невестка'
// reads clearly while a collapsed word would hide that the marriage ended.
function inLawBySpouse(s, fem, ex) {
  if (s.k === 'me') return { k: 'spouse', fem, ex };
  if (ex) return { k: 'spouseOf', fem, ex, of: s };
  if (fem && (isSibling(s, false) || isChild(s, false))) return { k: 'dil' };
  if (fem && isParent(s, false)) return { k: 'stepmother' };
  if (!fem && (isSibling(s, true) || isChild(s, true))) return { k: 'sonil' };
  if (!fem && isParent(s, true)) return { k: 'stepfather' };
  return { k: 'spouseOf', fem, of: s };
}

// status via a blood relative: X relates as rel to the person with status s
function inLawByBlood(s, rel) {
  if (s.k === 'me') return rel; // direct blood relation to the focus person
  if (s.k === 'spouse') {
    const viaFem = s.fem; // which spouse the link runs through
    if (isParent(rel, true)) return { k: 'mil', viaFem };
    if (isParent(rel, false)) return { k: 'fil', viaFem };
    if (isSibling(rel, false)) return { k: 'bil', viaFem };
    if (isSibling(rel, true)) return { k: 'sil', viaFem };
  }
  if (s.k === 'dil') { // the parents of a son's wife are сват/сватья
    if (isParent(rel, true)) return { k: 'coParent', fem: true };
    if (isParent(rel, false)) return { k: 'coParent', fem: false };
  }
  return { k: 'bloodOf', rel, of: s };
}

// Status of everyone relative to the focus person: the shortest path
// (counted in generations) over blood and marriage edges, so a father always
// lands one step closer than a son instead of at the same distance.
// At most one marriage per path, and no more than 2 blood steps after it:
// «теща», «бабушка жены», «муж тёти» are shown,
// while «троюродный внук мужа прабабушки» is nobody and gets no status.
// Queue-based relaxation (SPFA): recompute only when the path improves.
// Returns a map of person id -> kinship descriptor for I18n.renderTerm.
// Marriage budget sentinel: any blood step from a person carrying this is
// rejected, because the allowance is at most 2 and this exceeds it.
const INLAW_BLOCKED = 99;

function computeStatuses(focus) {
  const ancOf = new Map(people.map((p) => [p.id, ancestorDistances(p.id)]));
  const dist = new Map([[focus.id, 0]]);
  const edges = new Map([[focus.id, 0]]); // edge count: at equal dist a direct term beats a compound one
  // -1: no marriage on the path; >= 0: blood distance travelled after the marriage
  const bam = new Map([[focus.id, -1]]);
  const term = new Map([[focus.id, { k: 'me' }]]);
  const queue = [focus.id];
  while (queue.length) {
    const q = byId(queue.shift());
    const sq = term.get(q.id);
    const dq = dist.get(q.id);
    const mq = bam.get(q.id);
    // Blood edges: all of them from the focus person (direct kinship),
    // and at most 2 steps after a marriage («теща», «бабушка жены»).
    // Blood after blood is skipped: the direct edge from the focus person is
    // never worse, and for non-relatives it produces nonsense
    // such as «4Ю брат 3Ю дедушки», which is nobody.
    for (const p of people) {
      if (p.id === q.id) continue;
      if (mq === -1 && q.id !== focus.id) continue;
      const info = bloodInfo(q, p, ancOf.get(q.id), ancOf.get(p.id));
      if (!info) continue;
      let mp;
      if (mq === -1) {
        mp = -1;
      } else {
        mp = mq + info.dist;
        if (mp > 2) continue; // too far from the marriage, so nobody
      }
      const cand = dq + info.dist;
      const candEdges = edges.get(q.id) + 1;
      if (dist.has(p.id)) {
        const d = dist.get(p.id);
        if (d < cand || (d === cand && edges.get(p.id) <= candEdges)) continue;
      }
      dist.set(p.id, cand);
      edges.set(p.id, candEdges);
      bam.set(p.id, mp);
      term.set(p.id, inLawByBlood(sq, info.rel));
      queue.push(p.id);
    }
    // marriage edges (all of them, not just the first), at most one marriage per path
    if (mq === -1) {
      for (const { id: spId, ex } of spouseLinks(q.id)) {
        const sp = byId(spId);
        const cand = dq + 1;
        const candEdges = edges.get(q.id) + 1;
        if (dist.has(sp.id)) {
          const d = dist.get(sp.id);
          if (d < cand || (d === cand && edges.get(sp.id) <= candEdges)) continue;
        }
        dist.set(sp.id, cand);
        edges.set(sp.id, candEdges);
        // A divorce ends the in-law relationships it created: the ex-wife still
        // gets a term, but her mother is no longer anyone's mother-in-law.
        bam.set(sp.id, ex ? INLAW_BLOCKED : 0);
        term.set(sp.id, inLawBySpouse(sq, genderOf(sp) === 'Ж', ex));
        queue.push(sp.id);
      }
    }
  }
  return term;
}

function lifeDates(p) {
  const b = p.birthDate || '';
  const d = p.deathDate || '';
  if (b && d) return `${b} — ${d}`;
  if (b) return `${t('life.born')} ${b}`;
  if (d) return `† ${d}`;
  return '';
}

function ellipsize(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/* ============================================================
   Form: create and edit
   ============================================================ */
function showError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}
function clearError() {
  formError.classList.add('hidden');
}

// The form heading and the submit button depend on whether we are creating
// or editing, so they cannot be plain data-i18n targets like the rest.
function renderFormChrome() {
  formTitle.textContent = t(editingId ? 'form.edit' : 'form.new');
  submitBtn.textContent = t(editingId ? 'form.save' : 'form.add');
}

function resetForm() {
  editingId = null;
  closeMarriage();
  form.reset();
  renderFormChrome();
  cancelBtn.classList.add('hidden');
  relativesBox.classList.add('hidden');
  clearError();
  renderRelativeSelect();
}

function startEdit(id) {
  const p = byId(id);
  if (!p) return;
  editingId = id;
  closeMarriage();
  lastNameEl.value = p.lastName;
  maidenNameEl.value = p.maidenName || '';
  firstNameEl.value = p.firstName;
  middleNameEl.value = p.middleName;
  birthPlaceEl.value = p.birthPlace || '';
  notesEl.value = p.notes || '';
  fillDateParts(birthDayEl, birthMonthEl, birthYearEl, p.birthDate);
  fillDateParts(deathDayEl, deathMonthEl, deathYearEl, p.deathDate);
  renderFormChrome();
  cancelBtn.classList.remove('hidden');
  clearError();
  renderRelativeSelect();
  renderRelativesChips();
  // One marriage means there is nothing to pick, so show its details rather
  // than hiding them behind a click nobody knows to make.
  const own = marriagesOf(id);
  if (own.length === 1) openMarriage(own[0].id);
  focusToggle.checked = !!p.focus;
  lastNameEl.focus();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearError();

  const lastName = lastNameEl.value.trim();
  const maidenName = maidenNameEl.value.trim();
  const firstName = firstNameEl.value.trim();
  const middleName = middleNameEl.value.trim();
  const birthPlace = birthPlaceEl.value.trim();
  const notes = notesEl.value.trim();

  if (!lastName && !firstName) {
    showError(t('err.nameRequired'));
    return;
  }
  const birth = composeDate(birthDayEl, birthMonthEl, birthYearEl);
  if (birth === undefined) {
    showError(t('err.birthDate'));
    return;
  }
  const death = composeDate(deathDayEl, deathMonthEl, deathYearEl);
  if (death === undefined) {
    showError(t('err.deathDate'));
    return;
  }
  if (birth && death && parseRuDate(death) < parseRuDate(birth)) {
    showError(t('err.deathBeforeBirth'));
    return;
  }

  const pairs = formRelationPairs();
  if (pairs.length === 2 && pairs[0].otherId === pairs[1].otherId) {
    showError(t('err.sameRelatives'));
    return;
  }

  if (editingId) {
    const p = byId(editingId);
    if (!p) { resetForm(); return; }
    // apply the links first, then save the fields
    try {
      applyRelations(p, pairs);
    } catch (err) {
      showError(err.message);
      return;
    }
    p.lastName = lastName;
    p.maidenName = maidenName;
    p.firstName = firstName;
    p.middleName = middleName;
    p.birthDate = birth;
    p.birthPlace = birthPlace;
    p.notes = notes;
    p.deathDate = death;
    if (focusToggle.checked) setFocus(p.id, true);
    save();
    resetForm();
    renderAll();
  } else {
    const person = {
      id: uid(),
      lastName, maidenName, firstName, middleName,
      birthDate: birth,
      birthPlace,
      notes,
      deathDate: death,
      parents: [],
    };
    try {
      applyRelations(person, pairs);
    } catch (err) {
      showError(err.message);
      return;
    }
    people.push(person);
    if (focusToggle.checked) setFocus(person.id, true);
    save();
    resetForm();
    fitRequested = true; // fit the graph into view once the simulation stops
    renderAll();
  }
});

cancelBtn.addEventListener('click', resetForm);

// Toggling Focus while editing takes effect immediately:
// the person turns green in the table and on the graph right away
focusToggle.addEventListener('change', () => {
  if (!editingId) return; // no new person yet, the highlight appears once they are added
  setFocus(editingId, focusToggle.checked);
  save();
  renderTable();
  if (Graph) {
    for (const n of Graph.graphData().nodes) {
      n.focus = focusToggle.checked && n.id === editingId;
    }
    Graph.refresh();
  }
});

/* ---------- relative selects ---------- */
function fillRelativeSelect(sel) {
  const prev = sel.value;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = t('form.noneSelected');
  sel.appendChild(none);
  const sorted = [...people].sort((a, b) => fullName(a).localeCompare(fullName(b), I18n.collator()));
  for (const p of sorted) {
    if (p.id === editingId) continue;
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = fullName(p) + (p.birthDate ? ` (${p.birthDate.slice(-4)})` : '');
    sel.appendChild(opt);
  }
  if (prev && byId(prev) && prev !== editingId) sel.value = prev;
}

function renderRelativeSelect() {
  fillRelativeSelect(relativeSelect);
  fillRelativeSelect(relativeSelect2);
}

/* ---------- chips for current links while editing ---------- */
function renderRelativesChips() {
  relativesChips.innerHTML = '';
  if (!editingId) {
    relativesBox.classList.add('hidden');
    return;
  }
  const p = byId(editingId);
  if (!p) return;

  const chips = [];
  for (const pid of p.parents) {
    const parent = byId(pid);
    if (parent) chips.push({ kind: t('chip.parent'), person: parent, unlink: () => removeParent(p.id, pid) });
  }
  for (const child of people.filter((c) => c.parents.includes(p.id))) {
    chips.push({ kind: t('chip.child'), person: child, unlink: () => removeParent(child.id, p.id) });
  }
  for (const s of siblingsOf(p.id)) {
    chips.push({
      kind: t(genderOf(s) === 'Ж' ? 'chip.sister' : 'chip.brother'),
      person: s,
      readOnly: true, // remove a shared parent to break it, not this chip
    });
  }
  for (const m of marriagesOf(p.id)) {
    const other = byId(spouseIdIn(m, p.id));
    if (!other) continue;
    chips.push({
      kind: t(m.status === 'divorced' ? 'chip.exSpouse' : 'chip.spouse'),
      person: other,
      marriage: m,
      unlink: () => removeMarriage(m.id),
    });
  }

  if (!chips.length) {
    relativesBox.classList.add('hidden');
    return;
  }
  relativesBox.classList.remove('hidden');

  for (const chip of chips) {
    const el = document.createElement('span');
    el.className = chip.readOnly ? 'chip is-readonly' : 'chip';
    el.innerHTML = `<span class="chip-kind">${chip.kind}:</span> ${escapeHtml(fullName(chip.person))}`;
    if (chip.marriage) {
      el.classList.add('is-clickable');
      el.title = t('chip.openMarriage');
      if (chip.marriage.id === openMarriageId) el.classList.add('is-open');
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        if (chip.marriage.id === openMarriageId) {
          closeMarriage();
          renderRelativesChips();
        } else {
          openMarriage(chip.marriage.id);
        }
      });
      const wasDivorced = chip.marriage.status === 'divorced';
      const flip = document.createElement('button');
      flip.type = 'button';
      flip.className = 'chip-status';
      flip.title = t(wasDivorced ? 'chip.markMarried' : 'chip.markDivorced');
      flip.textContent = wasDivorced ? '↺' : '⚯';
      flip.addEventListener('click', () => {
        chip.marriage.status = wasDivorced ? 'married' : 'divorced';
        // going back to married drops a divorce date that no longer applies
        if (chip.marriage.status === 'married') chip.marriage.endDate = '';
        save();
        renderAll(); // a divorce changes statuses across the whole table
        if (chip.marriage.id === openMarriageId) openMarriage(chip.marriage.id);
      });
      el.appendChild(flip);
    }
    if (!chip.readOnly) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = t('chip.unlink');
      btn.textContent = '✕';
      btn.addEventListener('click', () => {
        chip.unlink();
        save();
        renderAll(); // dropping a link changes statuses, not just this box
      });
      el.appendChild(btn);
    }
    relativesChips.appendChild(el);
  }
}

/* ---------- details of one marriage ---------- */
// Opened by clicking a marriage chip. Kept out of the main submit flow: the
// fields write straight to the marriage as they are left, so the Save button
// stays about the person.
function openMarriage(id) {
  const m = marriages.find((x) => x.id === id);
  if (!m || !editingId) return;
  openMarriageId = id;
  const other = byId(spouseIdIn(m, editingId));
  marriageWho.textContent = other ? fullName(other) : '';
  fillDateParts(marDayEl, marMonthEl, marYearEl, m.date);
  fillDateParts(divDayEl, divMonthEl, divYearEl, m.endDate);
  marPlaceEl.value = m.place || '';
  marriageBox.classList.remove('hidden');
  renderRelativesChips();
}

function closeMarriage() {
  openMarriageId = null;
  marriageBox.classList.add('hidden');
}

function saveMarriage() {
  const m = marriages.find((x) => x.id === openMarriageId);
  if (!m) return;
  const date = composeDate(marDayEl, marMonthEl, marYearEl);
  if (date === undefined) { showError(t('err.marriageDate')); return; }
  const endDate = composeDate(divDayEl, divMonthEl, divYearEl);
  if (endDate === undefined) { showError(t('err.divorceDate')); return; }
  if (date && endDate && parseRuDate(endDate) < parseRuDate(date)) {
    showError(t('err.divorceBeforeMarriage'));
    return;
  }
  clearError();
  const wasStatus = m.status;
  m.date = date;
  m.place = marPlaceEl.value.trim();
  m.endDate = endDate;
  // A date for the divorce says the marriage ended, so the status follows it
  // rather than making you set both.
  if (endDate) m.status = 'divorced';
  save();
  renderTable();          // a divorce changes statuses across the table
  renderRelativesChips();
  if (m.status !== wasStatus) renderTree(); // the bar is drawn differently
}

for (const el of [marDayEl, marMonthEl, marYearEl, marPlaceEl, divDayEl, divMonthEl, divYearEl]) {
  el.addEventListener('change', saveMarriage);
  // these live inside the person form, and Enter there would submit it
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    saveMarriage();
  });
}

$('marriageClose').addEventListener('click', () => {
  closeMarriage();
  renderRelativesChips();
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ============================================================
   Sortable table
   ============================================================ */
function compareBy(key) {
  return (a, b) => {
    let va, vb;
    if (key === 'birthDate' || key === 'deathDate') {
      va = parseRuDate(a[key]);
      vb = parseRuDate(b[key]);
      // empty values always sort last
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sortState.dir;
    }
    va = (a[key] || '').toLowerCase();
    vb = (b[key] || '').toLowerCase();
    return va.localeCompare(vb, I18n.collator()) * sortState.dir;
  };
}

function renderTable() {
  peopleCount.textContent = people.length ? `(${people.length})` : '';
  tbody.innerHTML = '';

  if (!people.length) {
    tbody.innerHTML = `<tr class="row-empty"><td colspan="10">${escapeHtml(t('table.empty'))}</td></tr>`;
  } else {
    const sorted = [...people].sort(compareBy(sortState.key));
    const focusP = people.find((p) => p.focus) || null;
    const statusMap = focusP ? computeStatuses(focusP) : null;
    for (const p of sorted) {
      const tr = document.createElement('tr');
      tr.dataset.id = p.id;
      if (p.id === selectedId) tr.classList.add('selected');
      if (p.focus) tr.classList.add('focused');
      tr.innerHTML = `
        <td class="name-cell">${escapeHtml(p.lastName)}</td>
        <td>${escapeHtml(p.maidenName || '')}</td>
        <td>${escapeHtml(p.firstName)}</td>
        <td>${escapeHtml(p.middleName)}</td>
        <td>${escapeHtml(genderLabel(p))}</td>
        <td>${escapeHtml(p.birthDate)}</td>
        <td>${escapeHtml(p.birthPlace || '')}</td>
        <td>${escapeHtml(p.deathDate)}</td>
        <td>${escapeHtml(statusMap ? renderTerm(statusMap.get(p.id)) : '')}</td>
        <td></td>`;
      // Clicking anywhere on the row opens that person for editing and points
      // the view at them. The edit button keeps its own handler.
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        startEdit(p.id);
        focusOnPerson(p.id);
      });
      const btn = document.createElement('button');
      btn.className = 'edit-btn';
      btn.textContent = '✎';
      btn.title = t('table.edit');
      btn.addEventListener('click', () => startEdit(p.id));
      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    }
  }

  // sort arrows in the header
  document.querySelectorAll('#peopleTable th.sortable').forEach((th) => {
    const arrow = th.querySelector('.arrow');
    arrow.textContent = th.dataset.key === sortState.key ? (sortState.dir === 1 ? '▲' : '▼') : '';
  });
}

document.querySelectorAll('#peopleTable th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortState.key === key) {
      sortState.dir *= -1;
    } else {
      sortState = { key, dir: 1 };
    }
    renderTable();
  });
});

/* ============================================================
   Tree: a 3D force graph, the same approach as in mf-lab
   (3d-force-graph + three-spritetext, physical layout:
   node repulsion plus springs on the edges, orbit controls).
   Edges are direct parent -> child kinship only,
   and both parents carry equal weight.
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
  // Marriages are drawn too, so a couple reads as a couple even with no children.
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
  Graph = ForceGraph3D()(tree3d)
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

new ResizeObserver(sizeTree).observe(treeViewport);

function sizeTree() {
  if (chart) chart.fit();
  if (!Graph) return;
  Graph.width(treeViewport.clientWidth).height(treeViewport.clientHeight);
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
  tree3d.style.cursor = node ? 'pointer' : 'default';
  Graph.refresh();
}

// the camera flies over to the node, as in mf-lab
function flyCameraTo(node) {
  const dist = 140;
  const hyp = Math.hypot(node.x, node.y, node.z) || 1;
  const r = 1 + dist / hyp;
  Graph.cameraPosition(
    { x: node.x * r, y: node.y * r, z: node.z * r },
    { x: node.x, y: node.y, z: node.z },
    1200
  );
}

function handleNodeClick(node) {
  // Same as clicking the row in the list, so both views behave alike.
  startEdit(node.id);
  selectedId = node.id;
  renderTable();
  const row = tbody.querySelector(`tr[data-id="${node.id}"]`);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  flyCameraTo(node);
}

// focus a person from the table: highlight the row and fly the camera to the node
function focusOnPerson(id) {
  selectedId = id;
  renderTable();
  if (chart) {
    chart.centreOn(id);
    for (const g of treeChart.querySelectorAll('.chart-node')) {
      g.classList.toggle('is-selected', g.dataset.id === id);
    }
    return;
  }
  if (!Graph) return;
  const node = Graph.graphData().nodes.find((n) => n.id === id);
  if (node && node.x !== undefined) flyCameraTo(node);
}

// fit the graph into view using the simulation bounding box
// (the equivalent of fitMemoryTreeCameraFromSimulationLayout in mf-lab)
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

$('zoomIn').addEventListener('click', () => (chart ? chart.zoomIn() : zoomBy(0.75)));
$('zoomOut').addEventListener('click', () => (chart ? chart.zoomOut() : zoomBy(1.33)));
$('fitView').addEventListener('click', () => (chart ? chart.fit() : fitCamera()));

// View switch. Like the language button, it shows what you get by clicking:
// 'Древо' while the free graph layout is on screen.
function renderViewButton() {
  const goingToTree = viewMode !== 'tree';
  viewToggle.textContent = t(goingToTree ? 'tree.toTree' : 'tree.toGraph');
  viewToggle.title = t(goingToTree ? 'tree.toTreeTitle' : 'tree.toGraphTitle');
}

viewToggle.addEventListener('click', () => {
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
  langToggle.textContent = other.toUpperCase();
}

langToggle.addEventListener('click', () => I18n.toggleLang());

// Everything drawn from data has to be rebuilt: statuses, chips,
// select options and the life dates printed under the graph nodes.
I18n.onLangChange(() => {
  renderLangButton();
  renderViewButton();
  renderBanner();
  renderFormChrome();
  const app = document.querySelector('.app');
  $('collapseTab').title = t(app.classList.contains('collapsed') ? 'tree.showPanel' : 'tree.hidePanel');
  renderAll();
});

// side tab: hide or show the left panel, giving the space to the graph
$('collapseTab').addEventListener('click', () => {
  const app = document.querySelector('.app');
  const collapsed = app.classList.toggle('collapsed');
  const tab = $('collapseTab');
  tab.textContent = collapsed ? '›' : '‹';
  tab.title = t(collapsed ? 'tree.showPanel' : 'tree.hidePanel');
  sizeTree(); // the graph takes the freed space (ResizeObserver fires too)
});

// The classic chart: boxes in generation rows joined by right-angle lines.
// Everyone is drawn, so a spouse who married in brings their own parents and
// grandparents with them and the two lines meet at the marriage bar.
function renderChart() {
  const focused = people.find((p) => p.focus) || null;
  chart = FamilyChart.render(treeChart, {
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
    selectedId,
    onPick: (id) => {
      // Same as clicking the row in the list: open the person for editing
      // and highlight them.
      startEdit(id);
      selectedId = id;
      renderTable();
      const row = tbody.querySelector(`tr[data-id="${id}"]`);
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      // repaint the selection in place, so panning and zoom survive the click
      for (const g of treeChart.querySelectorAll('.chart-node')) {
        g.classList.toggle('is-selected', g.dataset.id === id);
      }
    },
  });
}

function renderTree() {
  treeEmpty.classList.toggle('hidden', people.length > 0);
  const showChart = viewMode === 'tree';
  tree3d.classList.toggle('hidden', showChart);
  treeChart.classList.toggle('hidden', !showChart);
  if (showChart) {
    renderChart();
    return;
  }
  chart = null;
  treeChart.textContent = '';
  if (!Graph) initTree();
  sizeTree(); // the container had no width while the chart was showing
  Graph.graphData(graphDataFromPeople());
  // physics, as in mf-lab: charge adapts to the node count
  Graph.d3Force('charge').strength(-260 * Math.sqrt(Math.max(1, people.length) / 100));
  Graph.d3Force('link').distance(110);
}

/* ============================================================
   Full render
   ============================================================ */
function renderAll() {
  renderRelativeSelect();
  renderTable();
  renderTree();
  if (editingId) renderRelativesChips();
}

boot();
