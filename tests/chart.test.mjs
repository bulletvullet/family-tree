// Layout tests for chart.js. Run with `make test`.
//
// The chart picks branch orders one of two ways: every order for a few linked
// branches, one at a time for more. Real trees grow from one into the other,
// so these tests cover both, plus data shapes the form allows that are easy to
// miss: parents with no sex filled in, a single parent, remarriages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('chart.js', root), 'utf8'), context);
const { layout, generations } = context.window.FamilyChart;

// Everyone gets a box, no two boxes overlap, and parents sit above children.
function check(name, { people, marriages }) {
  const { box } = layout(people, marriages, generations(people, marriages));
  for (const p of people) assert.ok(box.has(p.id), `${name}: ${p.id} has no box`);
  const boxes = [...box.values()];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${name}: ${a.id} and ${b.id} overlap`);
    }
  }
  for (const p of people) {
    for (const pid of p.parents) {
      if (!box.has(pid)) continue;
      assert.ok(box.get(pid).y < box.get(p.id).y, `${name}: ${pid} is not above their child ${p.id}`);
    }
  }
  return box;
}

const person = (id, gender, parents = []) => ({
  id, gender, parents, lastName: id, firstName: '', birthDate: '', focus: false,
});
const marriage = (a, b, status = 'married') => ({ id: `${a}+${b}`, a, b, status });

test('the example tree of the public page', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('deploy/tree/tree.example.json', root), 'utf8'));
  check('example', { people: doc.people, marriages: doc.marriages || [] });
});

test('more linked branches than the full search takes', () => {
  // Eight founding couples, each with a son and a daughter. Each son marries
  // the next family's daughter, so all eight branches link into one group.
  const people = [];
  const marriages = [];
  for (let i = 0; i < 8; i++) {
    people.push(person(`f${i}`, 'М'), person(`m${i}`, 'Ж'));
    marriages.push(marriage(`f${i}`, `m${i}`));
    people.push(person(`s${i}`, 'М', [`f${i}`, `m${i}`]), person(`d${i}`, 'Ж', [`f${i}`, `m${i}`]));
  }
  for (let i = 0; i < 7; i++) {
    marriages.push(marriage(`s${i}`, `d${i + 1}`));
    people.push(person(`k${i}`, 'Ж', [`s${i}`, `d${i + 1}`]));
  }
  check('eight branches', { people, marriages });
});

test('parents with no sex filled in', () => {
  // The case that once blanked the chart: a daughter of two parents with no
  // sex set, who married into another family and divorced.
  const people = [
    person('dad', ''), person('mum', ''),
    person('wife', 'Ж', ['dad', 'mum']),
    person('g', 'М'), person('gw', 'Ж'),
    person('husband', 'М', ['g', 'gw']),
  ];
  check('no sex', { people, marriages: [marriage('g', 'gw'), marriage('wife', 'husband', 'divorced')] });
});

test('same data, same layout', () => {
  const tree = generate(7, 6, 3);
  const a = check('first', tree);
  const b = check('second', tree);
  for (const [id, box] of a) assert.deepEqual(b.get(id), box, `${id} moved between two runs`);
});

test('generated trees of many shapes', () => {
  for (let seed = 1; seed <= 40; seed++) {
    check(`seed ${seed}`, generate(seed, 1 + (seed % 10), 2 + (seed % 3)));
  }
});

// A seeded random tree: founding couples, then generations of children who
// marry into other families or marry someone with no parents recorded. Some
// people have no sex set, some children only one parent, some remarry.
function generate(seed, founders, depth) {
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const people = [];
  const marriages = [];
  const lineOf = new Map();
  const add = (gender, parents, line) => {
    const p = person(`p${String(people.length).padStart(3, '0')}`, rand() < 0.1 ? '' : gender, parents);
    p.birthDate = rand() < 0.3 ? '' : String(1900 + people.length);
    people.push(p);
    lineOf.set(p.id, line);
    return p;
  };
  const marry = (a, b) => marriages.push(marriage(a.id, b.id, rand() < 0.2 ? 'divorced' : 'married'));

  let couples = [];
  for (let f = 0; f < founders; f++) {
    const a = add('М', [], f);
    const b = add('Ж', [], f);
    if (rand() < 0.8) marry(a, b); // otherwise they only share children
    couples.push([a, b]);
  }
  for (let g = 0; g < depth; g++) {
    const kids = [];
    for (const [a, b] of couples) {
      const count = Math.floor(rand() * 4);
      for (let i = 0; i < count; i++) {
        const parents = rand() < 0.15 ? [a.id] : [a.id, b.id];
        kids.push(add(rand() < 0.5 ? 'М' : 'Ж', parents, lineOf.get(a.id)));
      }
    }
    for (let i = kids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [kids[i], kids[j]] = [kids[j], kids[i]];
    }
    const next = [];
    while (kids.length) {
      const a = kids.shift();
      const j = kids.findIndex((b) => lineOf.get(b.id) !== lineOf.get(a.id) && rand() < 0.5);
      if (j >= 0) {
        const b = kids.splice(j, 1)[0];
        marry(a, b);
        next.push([a, b]);
      } else if (rand() < 0.6) {
        const spouse = add(a.gender === 'Ж' ? 'М' : 'Ж', [], lineOf.get(a.id));
        marry(a, spouse);
        next.push([a, spouse]);
        if (rand() < 0.15) {
          const second = add(a.gender === 'Ж' ? 'М' : 'Ж', [], lineOf.get(a.id));
          marry(a, second);
          next.push([a, second]);
        }
      }
    }
    couples = next;
  }
  return { people, marriages };
}
