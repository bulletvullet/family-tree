# Family tree

Local web app for keeping a family tree: a table of people, parent-child
links, marriages, automatic kinship status for everyone relative to one
chosen person, and an interactive 3D view.

## Running

```bash
make run                 # http://localhost:8791/
```

`make` on its own lists every target. Double-clicking `start.command` works
too (macOS).

If you are about to run anything against a live server, read
[Testing](#testing) first. A POST to `/api/tree` replaces the whole tree, and
that has already cost real data once.

- Data lives in SQLite (`data/family.db`), with a backup copy in localStorage.
- Dates can be partial: `YYYY`, `MM-YYYY` or `DD-MM-YYYY`. That applies to a
  wedding and a divorce as well as a birth and a death.
- A person can carry a place of birth, shown in the table and on hover in
  both views.
- Notes are a free-text box for anything the fields do not cover: occupation,
  places lived, stories. Line breaks are kept. They stay out of the table,
  which has no room for a paragraph, and show on hover in both views instead.
- The green person (the "Focus" switch) is the centre. Every kinship status
  in the table is computed relative to them.
- Clicking a person opens them for editing, from the table or from either
  view of the tree. The selection stays in step across all three.

## Marriages

Pick `супруг(а)` in the relation dropdown to marry two people. A person can
have any number of marriages, which is how remarriage is recorded. Children
are not attached to a marriage: a child names its own two parents, and that
pair already says which marriage it came from.

The links box while editing lists parents, children, siblings and marriages.
Siblings are shown for information and carry no remove button, because they
are not a stored link: they come from sharing a parent. Break the shared
parent to break the sibling. Anyone sharing at least one parent is listed, so
a half-sibling appears the same as a full one.

A marriage chip opens its details: the date and place of the wedding and the
date of the divorce. Someone with a single marriage gets those fields opened
for them; with more than one, click the chip for the marriage you mean. Filling in a divorce date marks the marriage
ended on its own, so you do not have to set both. These fields write
themselves as you leave them, which keeps the Save button about the person.

The chip also carries a small button that flips between married and divorced
for a split with no date to hand. A divorce is not a deletion. The former
spouse still shows as `бывшая жена`, but the in-laws it created go away, so
an ex-wife's mother stops being anyone's `теща`.

Couples with children still read as married even without a marriage record,
so trees built before this existed keep working.

## Two views

The toolbar switches between them.

- **Граф** is the free 3D layout. Physics places everyone, good for seeing
  clusters and how far apart branches sit.
- **Древо** is the classic chart: rounded boxes in generation rows joined by
  right-angle lines, a bar between a couple, and their children hanging from
  the middle of it. Drag to pan, wheel to zoom, click a box to open that
  person for editing. Clicking never re-frames the chart, so your pan and
  zoom survive.

The chart draws the whole connected tree, not one person's ancestry. Someone
who marries in brings their own parents and grandparents with them, so two
families meet at the marriage bar and both lines are visible at once.

Ordering is worked out rather than fixed: rows are swept until each person
sits near their relatives, and the people in a couple are seated so that
married pairs end up side by side. With a remarriage the row becomes a chain,
first wife then husband then second wife, which keeps both bars short and
stops one running across somebody else's box.

Families that share nobody are laid out separately and given their own band
of width, so two of them never interleave in a row. They still share the
generation rows, so everything lines up vertically and the chart just grows
sideways as you add more. A couple counts as a couple whether or not you
recorded a marriage: sharing a child is enough to seat them together.

Deceased people get a dashed outline, the focus person a green one, and a
former marriage a dashed grey bar instead of a solid one.

## Interface language

The `EN` / `RU` button in the tree toolbar switches the interface. The choice
is remembered in the browser. Kinship words are not a lookup table: Russian
and English split kinship differently, so `i18n.js` renders each relation per
language. Russian tells `теща` from `свекровь`; English calls both a
mother-in-law and instead counts cousins as "first cousin once removed".

Stored data stays as it is either way. Names, dates and the `М` / `Ж` sex
codes in the database do not change with the interface language.

## Public tree-only page

`deploy/tree/` is a standalone static page with the interactive 3D tree
(rotate, zoom, click a person, and the same graph and tree views). It reads
`tree.json` sitting next to it. That file is not in the repository because it
is personal data; `tree.example.json` shows the shape.

```bash
make export                                     # snapshot the current tree
make deploy DEPLOY_TARGET=user@host:/srv/tree/  # sync the page and upload
```

`deploy` keeps its own copies of `i18n.js`, `chart.js` and `graph-bundle.js`
so the page works on its own. `make sync` refreshes them.

## Built with

- Front end: plain JS plus
  [3d-force-graph](https://github.com/vasturiano/3d-force-graph)
  (vendored in `vendor/graph-bundle.js`)
- Back end: the Python standard library (`http.server` and `sqlite3`), no
  dependencies to install

## Testing

Read this before running anything against the app. Someone already destroyed
live data here, and the way it happened is not obvious.

`make run` owns port 8791 and the real `data/family.db`. A POST to
`/api/tree` replaces the whole tree in one transaction, so a single stray
request wipes everything. Use a throwaway instance:

```bash
make test-server     # port 8799, .test-data/, your data untouched
make test-reset      # throw that database away
```

### Check what is answering before you write

This is the rule that matters, and the one that was missing. Aiming at a
different port is not enough, because a server that fails to bind leaves the
previous one answering on that port. That is exactly what went wrong: a test
server could not take 8791, nobody checked, and every request after it landed
in the real database.

So confirm the process holding the port is the one you started, and that it
points at the database you meant:

```bash
pid=$(ss -lptn 'sport = :8799' | grep -oP 'pid=\K[0-9]+' | head -1)
tr '\0' '\n' < /proc/$pid/environ | grep FAMILY_TREE_DB
# expected: FAMILY_TREE_DB=.test-data/family.db
```

If that is not what you expect, stop. Do not send the request.

Three things now make this harder to get wrong, but none of them replace the
check above.

- The server refuses to start on a taken port, and binds before opening any
  database, so a refused start creates nothing.
- The page talks to whichever server served it, so a page on 8799 cannot
  write to 8791.
- `FAMILY_TREE_PORT` and `FAMILY_TREE_DB` mean a throwaway instance shares no
  state with the real one.

### Treat data/ as read-only

Never `rm -rf data/`, and never assume it is absent because it was absent
earlier: someone may start their own server mid-session. To check the live
state, GET and read. To test a migration against the real schema, copy the
file and point a test server at the copy:

```bash
cp data/family.db .test-data/family.db
```

If you do damage something, do not trust a check made after your own write.
Reading the database once your request has already overwritten those pages
proves nothing. The browser `localStorage` backup under
`familyTree.tree.v2` is the only other copy, and it is gone the moment the
app saves again.

### Two traps that let broken code pass

- **Synthetic clicks lie.** `dispatchEvent(new MouseEvent('click'))` skips the
  pointer pipeline, so it passes on code a real click cannot reach. It hid a
  pointer-capture bug that made the whole chart unclickable. Drive real input
  through the browser instead, for example `Input.dispatchMouseEvent` over the
  DevTools protocol.
- **`node --check` only parses.** It says nothing about whether the names a
  file calls exist. The public page once shipped calls to two functions it
  never defined. Compare defined against used when you move code between
  `app.js` and `deploy/tree/tree.js`, which keep separate copies on purpose.

`make check` compiles the Python and parses every JavaScript file. It is a
syntax gate, not a test suite.
