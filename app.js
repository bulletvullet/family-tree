/* ============================================================
   Семейное древо — логика приложения
   Данные: localStorage, ключ familyTree.people.v1
   Человек: { id, lastName, maidenName, firstName, middleName,
              birthDate, deathDate, gender, focus, parents: [id, ...] }
   Даты — строки 'ГГГГ' | 'ММ-ГГГГ' | 'ДД-ММ-ГГГГ' (бывают неполные)
   ============================================================ */

'use strict';

const STORAGE_KEY = 'familyTree.people.v1';      // резервная копия в браузере
const MIGRATED_KEY = 'familyTree.migrated.v1';   // флаг «перенесено в SQLite»
const API_URL = 'http://localhost:8791/api/people';

/* ---------- состояние ---------- */
let people = [];
let useServer = false;
let editingId = null;
let sortState = { key: 'lastName', dir: 1 }; // dir: 1 = A-Z, -1 = Z-A
let selectedId = null;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const form = $('personForm');
const lastNameEl = $('lastName');
const maidenNameEl = $('maidenName');
const firstNameEl = $('firstName');
const middleNameEl = $('middleName');
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
const tbody = $('peopleTbody');
const peopleCount = $('peopleCount');
const tree3d = $('tree3d');
const treeEmpty = $('treeEmpty');
const treeViewport = $('treeViewport');
const serverWarning = $('serverWarning');

/* ============================================================
   Хранилище: основное — SQLite на локальном сервере (server.py),
   плюс резервная копия в localStorage браузера.
   ============================================================ */
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
}

function showServerWarning() {
  serverWarning.classList.remove('hidden');
}
function hideServerWarning() {
  serverWarning.classList.add('hidden');
}

async function loadPeople() {
  try {
    const r = await fetch(API_URL);
    if (!r.ok) throw new Error('bad status');
    const arr = await r.json();
    useServer = true;
    hideServerWarning();
    return Array.isArray(arr) ? arr : [];
  } catch {
    useServer = false;
    showServerWarning();
    return loadLocal(); // fallback, чтобы хотя бы не потерять данные
  }
}

async function saveToServer() {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(people),
  });
  if (!r.ok) throw new Error('save failed');
}

function save() {
  saveLocal(); // резервная копия в браузере — всегда
  saveToServer()
    .then(() => { useServer = true; hideServerWarning(); })
    .catch(() => { useServer = false; showServerWarning(); });
}

// Загрузка при старте + одноразовая миграция localStorage -> SQLite
async function boot() {
  people = await loadPeople();
  if (useServer && people.length === 0 && !localStorage.getItem(MIGRATED_KEY)) {
    const legacy = loadLocal();
    if (legacy.length) {
      people = legacy;
      try {
        await saveToServer(); // переносим в SQLite, ничего не теряя
      } catch {
        showServerWarning();
      }
    }
    localStorage.setItem(MIGRATED_KEY, '1');
  }
  // заполнить пол тем, у кого его ещё нет (вывод из отчества/имени)
  let genderFilled = false;
  for (const p of people) {
    if (!p.gender) {
      p.gender = inferGender(p);
      if (p.gender) genderFilled = true;
    }
  }
  if (genderFilled) save();
  renderAll();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function byId(id) {
  return people.find((p) => p.id === id) || null;
}

// Фокус может быть только у одного человека:
// при установке снимаем его со всех остальных
function setFocus(id, on) {
  for (const p of people) p.focus = on && p.id === id;
}

/* ============================================================
   Даты: отдельные поля ДД / ММ / ГГГГ.
   Хранятся строкой: 'ГГГГ' | 'ММ-ГГГГ' | 'ДД-ММ-ГГГГ' —
   не все даты известны точно, достаточно года или месяца с годом.
   ============================================================ */
// только цифры в полях даты
for (const el of [birthDayEl, birthMonthEl, birthYearEl, deathDayEl, deathMonthEl, deathYearEl]) {
  el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, ''); });
}

// Собрать строку даты из трёх полей.
// Возвращает '' (все пустые) | строку даты | undefined (невалидно).
function composeDate(dEl, mEl, yEl) {
  const d = dEl.value.trim();
  const mo = mEl.value.trim();
  const y = yEl.value.trim();
  if (!d && !mo && !y) return '';
  if (!y) return undefined;              // год обязателен
  if (y.length !== 4) return undefined;
  if (d && !mo) return undefined;        // день без месяца нельзя
  if (mo && (+mo < 1 || +mo > 12)) return undefined;
  let s = y;
  if (mo) s = mo.padStart(2, '0') + '-' + s;
  if (d) s = d.padStart(2, '0') + '-' + s;
  // проверка по календарю (например, 31-02 не существует)
  if (parseRuDate(s) === undefined) return undefined;
  return s;
}

// Заполнить три поля из строки 'ГГГГ' | 'ММ-ГГГГ' | 'ДД-ММ-ГГГГ'
function fillDateParts(dEl, mEl, yEl, s) {
  const parts = (s || '').split('-');
  yEl.value = parts.pop() || '';
  mEl.value = parts.pop() || '';
  dEl.value = parts.pop() || '';
}

// 'ДД-ММ-ГГГГ' | 'ММ-ГГГГ' | 'ГГГГ' -> timestamp | null (пусто) | undefined (невалидно)
// неполная дата считается от начала месяца/года (для сортировки)
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
   Связи родитель-ребёнок
   ============================================================ */
// Является ли `ancestorId` предком `personId` (идём вверх по parents)
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

// Проверка возможности связи. Возвращает null, если связь допустима
// (или уже существует — тогда это no-op), иначе текст ошибки.
function canAddParent(child, parent) {
  if (child.id === parent.id) return 'Человек не может быть родителем самому себе';
  if (child.parents.includes(parent.id)) return null; // связь уже есть
  if (child.parents.length >= 2) {
    return `У ${fullName(child)} уже указано два родителя`;
  }
  if (isAncestor(child.id, parent.id)) {
    return 'Такая связь создаёт замкнутый круг в древе';
  }
  return null;
}

// Добавить parent к child. Бросает Error с текстом для пользователя.
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

// Пары «родственник + кем приходится» из формы (без пустых)
function formRelationPairs() {
  return [
    { otherId: relativeSelect.value, relType: relationSelect.value },
    { otherId: relativeSelect2.value, relType: relationSelect2.value },
  ].filter((r) => r.otherId);
}

// Применить несколько связей к человеку person атомарно:
// если какая-то связь недопустима, откатываем уже добавленные.
function applyRelations(person, pairs) {
  const applied = [];
  try {
    for (const { otherId, relType } of pairs) {
      if (otherId === person.id) throw new Error('Нельзя связать человека с самим собой');
      const other = byId(otherId);
      if (!other) continue;
      let child, parent;
      if (relType === 'father' || relType === 'mother') {
        child = person; parent = other; // выбранный — родитель человека
      } else {
        child = other; parent = person; // сын/дочь: человек — родитель выбранного
      }
      // папа/сын → М, мама/дочь → Ж
      other.gender = (relType === 'father' || relType === 'son') ? 'М' : 'Ж';
      const err = canAddParent(child, parent);
      if (err) throw new Error(err);
      if (!child.parents.includes(parent.id)) {
        child.parents.push(parent.id);
        applied.push([child, parent.id]);
      }
    }
  } catch (e) {
    for (const [child, pid] of applied) {
      child.parents = child.parents.filter((id) => id !== pid);
    }
    throw e;
  }
}

/* ============================================================
   Вспомогательные
   ============================================================ */
function fullName(p) {
  const last = p.maidenName
    ? (p.lastName ? `${p.lastName} (${p.maidenName})` : `(${p.maidenName})`)
    : p.lastName;
  return [last, p.firstName, p.middleName].filter(Boolean).join(' ');
}

// Вывод пола: по отчеству (-ич → М, -на → Ж),
// если отчества нет — по имени (-а/-я → Ж, иначе М; на -ь — неизвестно)
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

// Пол: отчество (-ич → М, -на → Ж) — самый надёжный признак, он в приоритете;
// если отчества нет или оно неоднозначно — сохранённое значение, затем вывод по имени
function genderOf(p) {
  const m = (p.middleName || '').trim().toLowerCase();
  if (m.endsWith('ич')) return 'М';
  if (m.endsWith('на')) return 'Ж';
  return p.gender || inferGender(p);
}

// расстояния в поколениях до всех предков personId (BFS вверх по parents)
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

// Кровное родство person к anchor: { term, dist } | null.
// dist — расстояние в поколениях (предок: g, потомок: h, боковая линия: g+h).
// aAnc/bAnc — карты предков из ancestorDistances (передаются, чтобы не считать заново)
function bloodInfo(anchor, person, aAnc, pAnc) {
  const fem = genderOf(person) === 'Ж';

  // person — прямой предок anchor
  if (aAnc.has(person.id)) {
    const g = aAnc.get(person.id);
    let term;
    if (g === 1) term = fem ? 'мама' : 'папа';
    else if (g === 2) term = fem ? 'бабушка' : 'дедушка';
    else if (g === 3) term = fem ? 'прабабушка' : 'прадедушка';
    else term = `${g - 2}П ${fem ? 'бабушка' : 'дедушка'}`;
    return { term, dist: g };
  }
  // person — прямой потомок anchor
  if (pAnc.has(anchor.id)) {
    const h = pAnc.get(anchor.id);
    let term;
    if (h === 1) term = fem ? 'дочь' : 'сын';
    else if (h === 2) term = fem ? 'внучка' : 'внук';
    else if (h === 3) term = fem ? 'правнучка' : 'правнук';
    else term = `${h - 2}П ${fem ? 'внучка' : 'внук'}`;
    return { term, dist: h };
  }
  // ближайший общий предок
  let best = null;
  for (const [id, g] of aAnc) {
    const h = pAnc.get(id);
    if (h === undefined) continue;
    if (!best || g + h < best.g + best.h) best = { g, h };
  }
  if (!best) return null;
  const { g, h } = best;
  let term;
  if (g === 1 && h === 1) term = fem ? 'сестра' : 'брат';
  else if (h === 1) term = g === 2 ? (fem ? 'тётя' : 'дядя') : `${g - 1}Ю ${fem ? 'бабушка' : 'дедушка'}`;
  else if (g === 1) term = h === 2 ? (fem ? 'племянница' : 'племянник') : `${h - 2}П ${fem ? 'племянница' : 'племянник'}`;
  else if (g === h) term = `${g}Ю ${fem ? 'сестра' : 'брат'}`;
  else if (g > h) {
    // старше на up поколений: 2Ю дедушка, 2Ю прадедушка, 2Ю 2П дедушка…
    const up = g - h;
    const w = up === 1 ? (fem ? 'бабушка' : 'дедушка')
            : up === 2 ? (fem ? 'прабабушка' : 'прадедушка')
            : `${up - 1}П ${fem ? 'бабушка' : 'дедушка'}`;
    term = `${h}Ю ${w}`;
  } else {
    // младше на down поколений: 3Ю внук, 3Ю правнук, 3Ю 2П внук…
    const down = h - g;
    const w = down === 1 ? (fem ? 'внучка' : 'внук')
            : down === 2 ? (fem ? 'правнучка' : 'правнук')
            : `${down - 1}П ${fem ? 'внучка' : 'внук'}`;
    term = `${g}Ю ${w}`;
  }
  return { term, dist: g + h };
}

// кровное родство person относительно фокусного ('' если не родственники)
function kinshipLabel(focus, person) {
  if (person.id === focus.id) return 'Я';
  const info = bloodInfo(focus, person, ancestorDistances(focus.id), ancestorDistances(person.id));
  return info ? info.term : '';
}

// все супруги: люди, с которыми у q есть общие дети
function coParents(q) {
  const out = [];
  for (const c of people) {
    if (!c.parents.includes(q.id)) continue;
    for (const id of c.parents) {
      if (id !== q.id && byId(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

// родительный падеж последнего слова статуса: 'мама жены', 'брат 2Ю сестры'
const GENITIVE = {
  мама: 'мамы', папа: 'папы', жена: 'жены', муж: 'мужа',
  брат: 'брата', сестра: 'сестры', сын: 'сына', дочь: 'дочери',
  бабушка: 'бабушки', дедушка: 'дедушки',
  прабабушка: 'прабабушки', прадедушка: 'прадедушки',
  внук: 'внука', внучка: 'внучки', правнук: 'правнука', правнучка: 'правнучки',
  тётя: 'тёти', дядя: 'дяди', племянник: 'племянника', племянница: 'племянницы',
  невестка: 'невестки', зять: 'зятя', мачеха: 'мачехи', отчим: 'отчима',
  теща: 'тещи', тесть: 'тестя', свекровь: 'свекрови', свекор: 'свекра',
  шурин: 'шурина', свояченица: 'свояченицы', деверь: 'деверя', золовка: 'золовки',
  сват: 'свата', сватья: 'сватьи',
};

function genitive(s) {
  const words = s.split(' ');
  // склоняем первое существительное — это голова цепочки:
  // '2Ю сестра' -> '2Ю сестры', 'муж 2П бабушки' -> 'мужа 2П бабушки'
  const i = words.findIndex((w) => GENITIVE[w]);
  if (i >= 0) words[i] = GENITIVE[words[i]];
  return words.join(' ');
}

// статус через супруга: X — жена/муж человека со статусом s
function inLawBySpouse(s, fem) {
  if (s === 'Я') return fem ? 'жена' : 'муж';
  if (fem && (s === 'брат' || s === 'сын')) return 'невестка';
  if (fem && s === 'папа') return 'мачеха';
  if (!fem && (s === 'сестра' || s === 'дочь')) return 'зять';
  if (!fem && s === 'мама') return 'отчим';
  return `${fem ? 'жена' : 'муж'} ${genitive(s)}`;
}

// статус через кровного родственника: X приходится k человеку со статусом s
function inLawByBlood(s, k) {
  if (s === 'Я') return k; // прямое кровное родство с фокусным
  if (s === 'жена') {
    if (k === 'мама') return 'теща';
    if (k === 'папа') return 'тесть';
    if (k === 'брат') return 'шурин';
    if (k === 'сестра') return 'свояченица';
  }
  if (s === 'муж') {
    if (k === 'мама') return 'свекровь';
    if (k === 'папа') return 'свекор';
    if (k === 'брат') return 'деверь';
    if (k === 'сестра') return 'золовка';
  }
  if (s === 'невестка') { // родители жены сына — сват/сватья
    if (k === 'мама') return 'сватья';
    if (k === 'папа') return 'сват';
  }
  return `${k} ${genitive(s)}`;
}

// Статусы всех людей относительно фокусного — кратчайший путь
// (в поколениях) по кровным и супружеским рёбрам: отец всегда
// окажется на шаг ближе сына, а не на том же расстоянии.
// Брак в пути — один, и после него не более 2 кровных шагов:
// «теща», «бабушка жены», «муж тёти» — показываем,
// а «троюродный внук мужа прабабушки» — уже никто, статус не выводим.
// Релаксация в очередь (SPFA): пересчёт только при улучшении пути.
function computeStatuses(focus) {
  const ancOf = new Map(people.map((p) => [p.id, ancestorDistances(p.id)]));
  const dist = new Map([[focus.id, 0]]);
  const edges = new Map([[focus.id, 0]]); // число рёбер: при равном dist прямой термин лучше составного
  // -1: брака в пути не было; >= 0: кровное расстояние, пройденное после брака
  const bam = new Map([[focus.id, -1]]);
  const term = new Map([[focus.id, 'Я']]);
  const queue = [focus.id];
  while (queue.length) {
    const q = byId(queue.shift());
    const sq = term.get(q.id);
    const dq = dist.get(q.id);
    const mq = bam.get(q.id);
    // кровные рёбра: от фокусного — все (прямое родство),
    // после брака — не более 2 шагов («теща», «бабушка жены»).
    // Кровь-после-крови пропускаем: прямое ребро от фокусного всегда
    // не хуже, а для не-родственников оно даёт чепуху
    // вида «4Ю брат 3Ю дедушки» — это уже никто.
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
        if (mp > 2) continue; // слишком далеко от брака — «никто»
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
      term.set(p.id, inLawByBlood(sq, info.term));
      queue.push(p.id);
    }
    // супружеские рёбра (все, а не первый попавшийся) — максимум один брак в пути
    if (mq === -1) {
      for (const spId of coParents(q)) {
        const sp = byId(spId);
        const cand = dq + 1;
        const candEdges = edges.get(q.id) + 1;
        if (dist.has(sp.id)) {
          const d = dist.get(sp.id);
          if (d < cand || (d === cand && edges.get(sp.id) <= candEdges)) continue;
        }
        dist.set(sp.id, cand);
        edges.set(sp.id, candEdges);
        bam.set(sp.id, 0);
        term.set(sp.id, inLawBySpouse(sq, genderOf(sp) === 'Ж'));
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
  if (b) return `р. ${b}`;
  if (d) return `† ${d}`;
  return '';
}

function ellipsize(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/* ============================================================
   Форма: создание и редактирование
   ============================================================ */
function showError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}
function clearError() {
  formError.classList.add('hidden');
}

function resetForm() {
  editingId = null;
  form.reset();
  formTitle.textContent = 'Новый человек';
  submitBtn.textContent = 'Добавить';
  cancelBtn.classList.add('hidden');
  relativesBox.classList.add('hidden');
  clearError();
  renderRelativeSelect();
}

function startEdit(id) {
  const p = byId(id);
  if (!p) return;
  editingId = id;
  lastNameEl.value = p.lastName;
  maidenNameEl.value = p.maidenName || '';
  firstNameEl.value = p.firstName;
  middleNameEl.value = p.middleName;
  fillDateParts(birthDayEl, birthMonthEl, birthYearEl, p.birthDate);
  fillDateParts(deathDayEl, deathMonthEl, deathYearEl, p.deathDate);
  formTitle.textContent = 'Редактирование';
  submitBtn.textContent = 'Сохранить';
  cancelBtn.classList.remove('hidden');
  clearError();
  renderRelativeSelect();
  renderRelativesChips();
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

  if (!lastName && !firstName) {
    showError('Укажите хотя бы имя или фамилию');
    return;
  }
  const birth = composeDate(birthDayEl, birthMonthEl, birthYearEl);
  if (birth === undefined) {
    showError('Дата рождения: год ГГГГ обязателен, месяц 1–12, день — по календарю');
    return;
  }
  const death = composeDate(deathDayEl, deathMonthEl, deathYearEl);
  if (death === undefined) {
    showError('Дата смерти: год ГГГГ обязателен, месяц 1–12, день — по календарю');
    return;
  }
  if (birth && death && parseRuDate(death) < parseRuDate(birth)) {
    showError('Дата смерти раньше даты рождения');
    return;
  }

  const pairs = formRelationPairs();
  if (pairs.length === 2 && pairs[0].otherId === pairs[1].otherId) {
    showError('Выберите двух разных родственников');
    return;
  }

  if (editingId) {
    const p = byId(editingId);
    if (!p) { resetForm(); return; }
    // сначала применяем связи, потом сохраняем поля
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
    fitRequested = true; // после остановки симуляции вписать граф в кадр
    renderAll();
  }
});

cancelBtn.addEventListener('click', resetForm);

// Переключение «Фокуса» при редактировании действует сразу:
// человек тут же подсвечивается зелёным в таблице и на графе
focusToggle.addEventListener('change', () => {
  if (!editingId) return; // нового человека ещё нет — подсветка появится после добавления
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

/* ---------- селекты родственников ---------- */
function fillRelativeSelect(sel) {
  const prev = sel.value;
  sel.innerHTML = '<option value="">— не выбран —</option>';
  const sorted = [...people].sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'));
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

/* ---------- чипы текущих связей при редактировании ---------- */
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
    if (parent) chips.push({ kind: 'Родитель', person: parent, unlink: () => removeParent(p.id, pid) });
  }
  for (const child of people.filter((c) => c.parents.includes(p.id))) {
    chips.push({ kind: 'Ребёнок', person: child, unlink: () => removeParent(child.id, p.id) });
  }

  if (!chips.length) {
    relativesBox.classList.add('hidden');
    return;
  }
  relativesBox.classList.remove('hidden');

  for (const chip of chips) {
    const el = document.createElement('span');
    el.className = 'chip';
    el.innerHTML = `<span class="chip-kind">${chip.kind}:</span> ${escapeHtml(fullName(chip.person))}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Убрать связь';
    btn.textContent = '✕';
    btn.addEventListener('click', () => {
      chip.unlink();
      save();
      renderRelativesChips();
      renderTree();
      renderRelativeSelect();
    });
    el.appendChild(btn);
    relativesChips.appendChild(el);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ============================================================
   Таблица с сортировкой
   ============================================================ */
function compareBy(key) {
  return (a, b) => {
    let va, vb;
    if (key === 'birthDate' || key === 'deathDate') {
      va = parseRuDate(a[key]);
      vb = parseRuDate(b[key]);
      // пустые значения всегда в конец
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sortState.dir;
    }
    va = (a[key] || '').toLowerCase();
    vb = (b[key] || '').toLowerCase();
    return va.localeCompare(vb, 'ru') * sortState.dir;
  };
}

function renderTable() {
  peopleCount.textContent = people.length ? `(${people.length})` : '';
  tbody.innerHTML = '';

  if (!people.length) {
    tbody.innerHTML = '<tr class="row-empty"><td colspan="9">Пока никого нет</td></tr>';
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
        <td>${escapeHtml(genderOf(p))}</td>
        <td>${escapeHtml(p.birthDate)}</td>
        <td>${escapeHtml(p.deathDate)}</td>
        <td>${escapeHtml(statusMap ? (statusMap.get(p.id) || '') : '')}</td>
        <td></td>`;
      // клик по фамилии — фокус камеры на этом человеке на графе
      tr.querySelector('.name-cell').addEventListener('click', () => focusOnPerson(p.id));
      const btn = document.createElement('button');
      btn.className = 'edit-btn';
      btn.textContent = '✎';
      btn.title = 'Изменить';
      btn.addEventListener('click', () => startEdit(p.id));
      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    }
  }

  // стрелки сортировки в шапке
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
   Дерево: 3D force-граф в пространстве — подход как в mf-lab
   (3d-force-graph + three-spritetext, физическая раскладка:
   отталкивание нод + пружины на рёбрах, orbit-управление).
   Рёбра — только прямое родство родитель→ребёнок,
   оба родителя равнозначны.
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
  Graph = ForceGraph3D()(tree3d)
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

  new ResizeObserver(sizeTree).observe(treeViewport);
  sizeTree();
}

function sizeTree() {
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

// камера подлетает к ноде — как в mf-lab
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
  selectedId = node.id;
  renderTable();
  const row = tbody.querySelector(`tr[data-id="${node.id}"]`);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  flyCameraTo(node);
}

// фокус на человеке из таблицы: подсветка строки + подлёт камеры к ноде
function focusOnPerson(id) {
  selectedId = id;
  renderTable();
  if (!Graph) return;
  const node = Graph.graphData().nodes.find((n) => n.id === id);
  if (node && node.x !== undefined) flyCameraTo(node);
}

// вписать граф в кадр по bbox симуляции
// (аналог fitMemoryTreeCameraFromSimulationLayout из mf-lab)
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

$('zoomIn').addEventListener('click', () => zoomBy(0.75));
$('zoomOut').addEventListener('click', () => zoomBy(1.33));
$('fitView').addEventListener('click', () => fitCamera());

// ушко: скрыть/показать левую панель, отдав место графу
$('collapseTab').addEventListener('click', () => {
  const app = document.querySelector('.app');
  const collapsed = app.classList.toggle('collapsed');
  const tab = $('collapseTab');
  tab.textContent = collapsed ? '›' : '‹';
  tab.title = collapsed ? 'Показать панель' : 'Скрыть панель';
  sizeTree(); // граф занимает освободившееся место (ResizeObserver тоже сработает)
});

function renderTree() {
  treeEmpty.classList.toggle('hidden', people.length > 0);
  if (!Graph) initTree();
  Graph.graphData(graphDataFromPeople());
  // физика — как в mf-lab: charge адаптируется к числу нод
  Graph.d3Force('charge').strength(-260 * Math.sqrt(Math.max(1, people.length) / 100));
  Graph.d3Force('link').distance(110);
}

/* ============================================================
   Общий рендер
   ============================================================ */
function renderAll() {
  renderRelativeSelect();
  renderTable();
  renderTree();
  if (editingId) renderRelativesChips();
}

boot();
