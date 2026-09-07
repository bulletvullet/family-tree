/* ============================================================
   Family tree: interface language (Russian / English).

   Two jobs:
   1. Static interface strings, looked up with t('key').
   2. Kinship terms. The engine in app.js never builds a term as
      text: it builds a descriptor ({ k: 'anc', g: 2, fem: true })
      and renderTerm() turns it into a word in the current language.
      Russian and English split kinship differently, so a single
      string table cannot cover it. Russian tells «теща» from
      «свекровь», English calls both a mother-in-law.

   Language lives in localStorage and defaults to Russian.
   ============================================================ */

'use strict';

// Classic script, no module system: everything below stays inside this
// closure so only window.I18n reaches the global scope. Without it the
// helpers here would collide with same-named ones in app.js.
(function () {

const LANG_KEY = 'familyTree.lang.v1';
const LANGS = ['ru', 'en'];

let lang = (() => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return LANGS.includes(saved) ? saved : 'ru';
  } catch {
    return 'ru';
  }
})();

/* ============================================================
   Static interface strings
   ============================================================ */
const STRINGS = {
  ru: {
    'app.title': 'Семейное древо',
    'app.langNext': 'Switch to English',

    'form.new': 'Новый человек',
    'form.edit': 'Редактирование',
    'form.lastName': 'Фамилия',
    'form.maidenName': 'Девичья фамилия',
    'form.firstName': 'Имя',
    'form.middleName': 'Отчество',
    'form.birthDate': 'Дата рождения',
    'form.birthPlace': 'Место рождения',
    'form.notes': 'Заметки',
    'form.deathDate': 'Дата смерти',
    'form.relative': 'Родственник',
    'form.relative2': 'Родственник 2',
    'form.relationIs': 'Он(а) приходится',
    'form.optional': '(если есть)',
    'form.optional2': '(необязательно)',
    'form.noneSelected': '— не выбран —',
    'form.currentLinks': 'Текущие связи:',
    'form.add': 'Добавить',
    'form.save': 'Сохранить',
    'form.cancel': 'Отмена',
    'form.focus': 'Фокус',

    'ph.lastName': 'Иванов',
    'ph.maidenName': 'Петрова',
    'ph.firstName': 'Иван',
    'ph.middleName': 'Иванович',
    'ph.birthPlace': 'Минск',
    'ph.notes': 'Профессия, места жизни, семейные истории',
    'ph.day': 'ДД',
    'ph.month': 'ММ',
    'ph.year': 'ГГГГ',

    'rel.father': 'папа',
    'rel.mother': 'мама',
    'rel.son': 'сын',
    'rel.daughter': 'дочь',
    'rel.spouse': 'супруг(а)',

    'chip.parent': 'Родитель',
    'chip.child': 'Ребёнок',
    'chip.brother': 'Брат',
    'chip.sister': 'Сестра',
    'chip.spouse': 'Супруг(а)',
    'chip.exSpouse': 'Бывш. супруг(а)',
    'chip.unlink': 'Убрать связь',
    'chip.openMarriage': 'Открыть даты и место брака',
    'chip.markDivorced': 'Отметить развод',
    'chip.markMarried': 'Вернуть в брак',

    'marriage.title': 'Брак:',
    'marriage.date': 'Дата брака',
    'marriage.place': 'Место брака',
    'marriage.endDate': 'Дата развода',
    'marriage.close': 'Свернуть',
    'ph.marriagePlace': 'Минск',
    'err.marriageDate': 'Дата брака: год ГГГГ обязателен, месяц 1-12, день по календарю',
    'err.divorceDate': 'Дата развода: год ГГГГ обязателен, месяц 1-12, день по календарю',
    'err.divorceBeforeMarriage': 'Развод раньше свадьбы',

    'table.all': 'Все люди',
    'table.lastName': 'Фамилия',
    'table.maidenName': 'Девичья',
    'table.firstName': 'Имя',
    'table.middleName': 'Отчество',
    'table.gender': 'Пол',
    'table.birth': 'Рождение',
    'table.birthPlace': 'Место',
    'table.death': 'Смерть',
    'table.status': 'Статус',
    'table.empty': 'Пока никого нет',
    'table.edit': 'Изменить',

    'gender.m': 'М',
    'gender.f': 'Ж',

    'tree.title': 'Древо',
    'tree.zoomOut': 'Отдалить',
    'tree.zoomIn': 'Приблизить',
    'tree.fit': 'Вписать',
    'tree.hidePanel': 'Скрыть панель',
    'tree.showPanel': 'Показать панель',
    'tree.toTree': 'Древо',
    'tree.toGraph': 'Граф',
    'tree.toTreeTitle': 'Разложить по поколениям',
    'tree.toGraphTitle': 'Свободная раскладка',
    'tree.empty': 'Добавьте первого человека в форме слева',
    'tree.noData': 'Нет данных',

    'err.nameRequired': 'Укажите хотя бы имя или фамилию',
    'err.birthDate': 'Дата рождения: год ГГГГ обязателен, месяц 1-12, день по календарю',
    'err.deathDate': 'Дата смерти: год ГГГГ обязателен, месяц 1-12, день по календарю',
    'err.deathBeforeBirth': 'Дата смерти раньше даты рождения',
    'err.sameRelatives': 'Выберите двух разных родственников',
    'err.selfParent': 'Человек не может быть родителем самому себе',
    'err.selfLink': 'Нельзя связать человека с самим собой',
    'err.twoParents': 'У {name} уже указано два родителя',
    'err.cycle': 'Такая связь создаёт замкнутый круг в древе',

    'server.warning': 'Нет связи с сервером БД. Запустите {cmd} в папке сайта. ' +
      'Пока данные сохраняются только в браузере!',
    'server.stale': 'Сервер работает на старом коде. Перезапустите его ({cmd}): ' +
      'новые поля он молча выбрасывает и в базу они не попадут. ' +
      'Полная копия пока лежит в браузере.',

    'life.born': 'р.',
  },

  en: {
    'app.title': 'Family Tree',
    'app.langNext': 'Переключить на русский',

    'form.new': 'New person',
    'form.edit': 'Editing',
    'form.lastName': 'Last name',
    'form.maidenName': 'Maiden name',
    'form.firstName': 'First name',
    'form.middleName': 'Patronymic',
    'form.birthDate': 'Date of birth',
    'form.birthPlace': 'Place of birth',
    'form.notes': 'Notes',
    'form.deathDate': 'Date of death',
    'form.relative': 'Relative',
    'form.relative2': 'Relative 2',
    'form.relationIs': 'They are the',
    'form.optional': '(if known)',
    'form.optional2': '(optional)',
    'form.noneSelected': '(none)',
    'form.currentLinks': 'Current links:',
    'form.add': 'Add',
    'form.save': 'Save',
    'form.cancel': 'Cancel',
    'form.focus': 'Focus',

    'ph.lastName': 'Ivanov',
    'ph.maidenName': 'Petrova',
    'ph.firstName': 'Ivan',
    'ph.middleName': 'Ivanovich',
    'ph.birthPlace': 'Minsk',
    'ph.notes': 'Occupation, places lived, family stories',
    'ph.day': 'DD',
    'ph.month': 'MM',
    'ph.year': 'YYYY',

    'rel.father': 'father',
    'rel.mother': 'mother',
    'rel.son': 'son',
    'rel.daughter': 'daughter',
    'rel.spouse': 'spouse',

    'chip.parent': 'Parent',
    'chip.child': 'Child',
    'chip.brother': 'Brother',
    'chip.sister': 'Sister',
    'chip.spouse': 'Spouse',
    'chip.exSpouse': 'Former spouse',
    'chip.unlink': 'Remove link',
    'chip.openMarriage': 'Open the marriage dates and place',
    'chip.markDivorced': 'Mark as divorced',
    'chip.markMarried': 'Mark as married',

    'marriage.title': 'Marriage:',
    'marriage.date': 'Date of marriage',
    'marriage.place': 'Place of marriage',
    'marriage.endDate': 'Date of divorce',
    'marriage.close': 'Collapse',
    'ph.marriagePlace': 'Minsk',
    'err.marriageDate': 'Date of marriage: a 4-digit year is required, month 1-12, the day must exist in the calendar',
    'err.divorceDate': 'Date of divorce: a 4-digit year is required, month 1-12, the day must exist in the calendar',
    'err.divorceBeforeMarriage': 'The divorce is earlier than the wedding',

    'table.all': 'All people',
    'table.lastName': 'Last name',
    'table.maidenName': 'Maiden',
    'table.firstName': 'First name',
    'table.middleName': 'Patronymic',
    'table.gender': 'Sex',
    'table.birth': 'Born',
    'table.birthPlace': 'Place',
    'table.death': 'Died',
    'table.status': 'Relation',
    'table.empty': 'Nobody here yet',
    'table.edit': 'Edit',

    'gender.m': 'M',
    'gender.f': 'F',

    'tree.title': 'Tree',
    'tree.zoomOut': 'Zoom out',
    'tree.zoomIn': 'Zoom in',
    'tree.fit': 'Fit to view',
    'tree.hidePanel': 'Hide panel',
    'tree.showPanel': 'Show panel',
    'tree.toTree': 'Tree',
    'tree.toGraph': 'Graph',
    'tree.toTreeTitle': 'Lay out by generation',
    'tree.toGraphTitle': 'Free layout',
    'tree.empty': 'Add the first person using the form on the left',
    'tree.noData': 'No data',

    'err.nameRequired': 'Enter at least a first name or a last name',
    'err.birthDate': 'Date of birth: a 4-digit year is required, month 1-12, the day must exist in the calendar',
    'err.deathDate': 'Date of death: a 4-digit year is required, month 1-12, the day must exist in the calendar',
    'err.deathBeforeBirth': 'Date of death is earlier than the date of birth',
    'err.sameRelatives': 'Pick two different relatives',
    'err.selfParent': 'A person cannot be their own parent',
    'err.selfLink': 'A person cannot be linked to themselves',
    'err.twoParents': '{name} already has two parents',
    'err.cycle': 'That link would create a loop in the tree',

    'server.warning': 'No connection to the database server. Run {cmd} in the site folder. ' +
      'Until then data is saved in the browser only!',
    'server.stale': 'The server is running old code. Restart it ({cmd}): it drops ' +
      'the newer fields without a word and they will never reach the database. ' +
      'A full copy is in the browser meanwhile.',

    'life.born': 'b.',
  },
};

// Interface string by key. Params fill {placeholders}: t('err.twoParents', { name })
function t(key, params) {
  let s = STRINGS[lang][key];
  if (s === undefined) s = STRINGS.ru[key];
  if (s === undefined) return key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split('{' + k + '}').join(v);
  }
  return s;
}

/* ============================================================
   Kinship terms

   Descriptors the engine produces:
     { k: 'me' }
     { k: 'anc',  g, fem }        direct ancestor, g generations up
     { k: 'desc', h, fem }        direct descendant, h generations down
     { k: 'sib',  fem }           sibling
     { k: 'pib',  g, fem }        sibling of an ancestor g generations up
     { k: 'nib',  h, fem }        descendant of a sibling, h generations down
     { k: 'cous', g, h, fem }     common ancestor g up from anchor, h up from person
     { k: 'spouse', fem, ex }     spouse of the focus person, ex if divorced
     { k: 'dil' } { k: 'sonil' }  child's spouse
     { k: 'stepmother' } { k: 'stepfather' }
     { k: 'mil', viaFem } { k: 'fil', viaFem }   spouse's parent
     { k: 'bil', viaFem } { k: 'sil', viaFem }   spouse's sibling
     { k: 'coParent', fem }       parent of a child's spouse
     { k: 'spouseOf', fem, ex, of }  spouse of another term
     { k: 'bloodOf', rel, of }    blood relative of another term

   viaFem says which spouse the link runs through: true for a wife,
   false for a husband. Russian needs it («теща» against «свекровь»),
   English ignores it.
   ============================================================ */

/* ---------- Russian ---------- */

// genitive case of the head noun: 'мама жены', 'брат 2Ю сестры'
const GENITIVE_RU = {
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

function genitiveRu(s) {
  const words = s.split(' ');
  // decline the first noun, it is the head of the chain:
  // '2Ю сестра' -> '2Ю сестры', 'муж 2П бабушки' -> 'мужа 2П бабушки'
  const i = words.findIndex((w) => GENITIVE_RU[w]);
  if (i >= 0) words[i] = GENITIVE_RU[words[i]];
  return words.join(' ');
}

function renderRu(x) {
  const fem = x.fem;
  switch (x.k) {
    case 'me': return 'Я';

    case 'anc':
      if (x.g === 1) return fem ? 'мама' : 'папа';
      if (x.g === 2) return fem ? 'бабушка' : 'дедушка';
      if (x.g === 3) return fem ? 'прабабушка' : 'прадедушка';
      return `${x.g - 2}П ${fem ? 'бабушка' : 'дедушка'}`;

    case 'desc':
      if (x.h === 1) return fem ? 'дочь' : 'сын';
      if (x.h === 2) return fem ? 'внучка' : 'внук';
      if (x.h === 3) return fem ? 'правнучка' : 'правнук';
      return `${x.h - 2}П ${fem ? 'внучка' : 'внук'}`;

    case 'sib': return fem ? 'сестра' : 'брат';

    case 'pib':
      return x.g === 2 ? (fem ? 'тётя' : 'дядя')
                       : `${x.g - 1}Ю ${fem ? 'бабушка' : 'дедушка'}`;

    case 'nib':
      return x.h === 2 ? (fem ? 'племянница' : 'племянник')
                       : `${x.h - 2}П ${fem ? 'племянница' : 'племянник'}`;

    case 'cous': {
      const { g, h } = x;
      if (g === h) return `${g}Ю ${fem ? 'сестра' : 'брат'}`;
      if (g > h) {
        // older by `up` generations: 2Ю дедушка, 2Ю прадедушка, 2Ю 2П дедушка...
        const up = g - h;
        const w = up === 1 ? (fem ? 'бабушка' : 'дедушка')
                : up === 2 ? (fem ? 'прабабушка' : 'прадедушка')
                : `${up - 1}П ${fem ? 'бабушка' : 'дедушка'}`;
        return `${h}Ю ${w}`;
      }
      // younger by `down` generations: 3Ю внук, 3Ю правнук, 3Ю 2П внук...
      const down = h - g;
      const w = down === 1 ? (fem ? 'внучка' : 'внук')
              : down === 2 ? (fem ? 'правнучка' : 'правнук')
              : `${down - 1}П ${fem ? 'внучка' : 'внук'}`;
      return `${g}Ю ${w}`;
    }

    case 'spouse':
      if (x.ex) return fem ? 'бывшая жена' : 'бывший муж';
      return fem ? 'жена' : 'муж';
    case 'dil': return 'невестка';
    case 'sonil': return 'зять';
    case 'stepmother': return 'мачеха';
    case 'stepfather': return 'отчим';
    case 'mil': return x.viaFem ? 'теща' : 'свекровь';
    case 'fil': return x.viaFem ? 'тесть' : 'свекор';
    case 'bil': return x.viaFem ? 'шурин' : 'деверь';
    case 'sil': return x.viaFem ? 'свояченица' : 'золовка';
    case 'coParent': return fem ? 'сватья' : 'сват';

    case 'spouseOf': {
      const w = x.ex ? (fem ? 'бывшая жена' : 'бывший муж') : (fem ? 'жена' : 'муж');
      return `${w} ${genitiveRu(renderRu(x.of))}`;
    }
    case 'bloodOf': return `${renderRu(x.rel)} ${genitiveRu(renderRu(x.of))}`;

    default: return '';
  }
}

/* ---------- English ---------- */

function ordinalEn(n) {
  const rest100 = n % 100;
  if (rest100 >= 11 && rest100 <= 13) return `${n}th`;
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

function timesEn(n) {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

// 'great' repeated n times: 0 -> '', 1 -> 'great-', 3 -> '3×great-'
function greatsEn(n) {
  if (n <= 0) return '';
  if (n === 1) return 'great-';
  if (n === 2) return 'great-great-';
  return `${n}×great-`;
}

// possessive form used to chain terms: "wife's grandmother"
function possessiveEn(s) {
  return s.endsWith('s') ? `${s}'` : `${s}'s`;
}

function renderEn(x) {
  const fem = x.fem;
  switch (x.k) {
    case 'me': return 'Me';

    case 'anc':
      if (x.g === 1) return fem ? 'mother' : 'father';
      return greatsEn(x.g - 2) + (fem ? 'grandmother' : 'grandfather');

    case 'desc':
      if (x.h === 1) return fem ? 'daughter' : 'son';
      return greatsEn(x.h - 2) + (fem ? 'granddaughter' : 'grandson');

    case 'sib': return fem ? 'sister' : 'brother';

    // sibling of an ancestor: aunt, great-aunt, great-great-aunt...
    case 'pib': return greatsEn(x.g - 2) + (fem ? 'aunt' : 'uncle');

    // descendant of a sibling: niece, great-niece...
    case 'nib': return greatsEn(x.h - 2) + (fem ? 'niece' : 'nephew');

    // English counts cousins by the nearer side and "removes" the difference:
    // common ancestor 3 up from me and 2 up from them is a first cousin once removed
    case 'cous': {
      const degree = Math.min(x.g, x.h) - 1;
      const removed = Math.abs(x.g - x.h);
      const base = `${ordinalEn(degree)} cousin`;
      return removed ? `${base} ${timesEn(removed)} removed` : base;
    }

    case 'spouse':
      if (x.ex) return fem ? 'ex-wife' : 'ex-husband';
      return fem ? 'wife' : 'husband';
    case 'dil': return 'daughter-in-law';
    case 'sonil': return 'son-in-law';
    case 'stepmother': return 'stepmother';
    case 'stepfather': return 'stepfather';
    case 'mil': return 'mother-in-law';
    case 'fil': return 'father-in-law';
    case 'bil': return 'brother-in-law';
    case 'sil': return 'sister-in-law';
    case 'coParent': return fem ? 'co-mother-in-law' : 'co-father-in-law';

    case 'spouseOf':
      return `${possessiveEn(renderEn(x.of))} ${x.ex ? 'ex-' : ''}${fem ? 'wife' : 'husband'}`;
    case 'bloodOf': return `${possessiveEn(renderEn(x.of))} ${renderEn(x.rel)}`;

    default: return '';
  }
}

// Kinship descriptor -> word in the current language
function renderTerm(x) {
  if (!x) return '';
  return lang === 'en' ? renderEn(x) : renderRu(x);
}

/* ============================================================
   Applying the language to the page
   ============================================================ */
const langListeners = [];

// Fill every element carrying data-i18n / data-i18n-ph / data-i18n-title
function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    el.placeholder = t(el.dataset.i18nPh);
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  document.documentElement.lang = lang;
  const title = STRINGS[lang]['app.title'];
  if (title) document.title = title;
}

function getLang() {
  return lang;
}

function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // private mode or storage disabled: the choice just will not survive a reload
  }
  applyStatic();
  for (const cb of langListeners) cb(lang);
}

function toggleLang() {
  setLang(lang === 'ru' ? 'en' : 'ru');
}

// Called after every language change so the app can re-render its dynamic parts
function onLangChange(cb) {
  langListeners.push(cb);
}

// Collation for sorting names in the current language
function collator() {
  return lang === 'en' ? 'en' : 'ru';
}

window.I18n = {
  t, getLang, setLang, toggleLang, onLangChange,
  applyStatic, renderTerm, collator, LANGS,
};

})();
