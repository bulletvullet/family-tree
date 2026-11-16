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

- Data lives in one JSON file, `data/family.json`, with a copy in the
  browser's localStorage. If an older `data/family.db` is there on the first
  start, the server imports it once and leaves that file as it was.
- Dates can be partial: `YYYY`, `MM-YYYY` or `DD-MM-YYYY`. That applies to a
  wedding and a divorce as well as a birth and a death.
- A person can carry a place of birth, shown in the table and on hover in
  both views.
- The `Умер(ла)` switch marks someone dead when the date is unknown. Dates
  then read `1950 — †`. A death date turns the switch on by itself.
- The table shows the age of everyone alive. With only a birth year, or a
  birth month that is this month, the birthday may still be ahead, so the
  age reads `~33`.
- The search box above the table filters it by last, maiden, first name or
  patronymic. Each word you type must start one of the names, so `ив пет`
  finds Иван Петрович. `е` also matches `ё`.
- On a short window the form scrolls inside its card instead of squeezing
  the table.
- Notes are a free-text box for anything the fields do not cover: occupation,
  places lived, stories. Line breaks are kept. They stay out of the table,
  which has no room for a paragraph, and show on hover in both views instead.
- The green person (the "Focus" switch) is the centre. Every kinship status
  in the table is computed relative to them.
- Clicking a person opens them for editing, from the table or from either
  view of the tree. The selection stays in step across all three.
- Drag the strip between the two panels to resize them, and double-click it
  to split them evenly again. The browser remembers the width.

## Backups

`Скачать` above the people list saves the whole tree as one JSON file.
`Загрузить` reads such a file back and replaces the tree after you confirm.
The file has the same shape as `data/family.json`, so you can also stop the
server and copy a download over it.

The server copies the current file into `data/backups/` by itself:

- before every import, as `family-<time>-import.json`;
- before a save, if the newest backup is more than a day old, as
  `family-<time>-auto.json`.

`make backup` makes one on request (`-manual.json`). Nothing deletes old
backups. To restore one, import it with the button.

The server never overwrites a `data/family.json` it cannot parse. After a
bad hand edit it reports the error and keeps the file.

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
  person for editing. Clicking, saving and resizing never re-frame the
  chart, so your pan and zoom survive. `⤢` frames everyone again.

The chart draws the whole connected tree, not one person's ancestry. Someone
who marries in brings their own parents and grandparents with them, so two
families meet at the marriage bar and both lines are visible at once.

The chart is cut into branches, one line of descent each, traced through
fathers the way a surname goes. Someone with no parents recorded joins the
branch of the person they married, since there is no family of theirs to
show. Each branch is drawn as its own block, with a wider gap between blocks.
The only lines across that gap are marriages, so a daughter who married out
stays in her parents' block, and her children hang from the marriage into
her husband's. Inside a block every child's descendants stay under that
child, so cousins' families never interleave. The blocks are ordered to keep
marriage lines short, and a short block can tuck under a tall one's empty
rows.

Siblings always share a row, and their parents sit right above them. When
two families' lines would overlap in the same gap, each gets its own height,
and where one line crosses another it shows a small break, so a crossing
never looks like a join. A couple counts as a couple whether or not you
recorded a marriage: sharing a child is enough.

Deceased people get a dashed outline, the focus person a green one, and a
former marriage a dashed grey bar instead of a solid one.

## Interface language

The `EN` / `RU` button in the tree toolbar switches the interface. The choice
is remembered in the browser. Kinship words are not a lookup table: Russian
and English split kinship differently, so `i18n.js` renders each relation per
language. Russian tells `теща` from `свекровь`; English calls both a
mother-in-law and instead counts cousins as "first cousin once removed".

Stored data stays as it is either way. Names, dates and the `М` / `Ж` sex
codes in the data file do not change with the interface language.

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
- Back end: the Python standard library (`http.server`, plus `sqlite3` for
  the one-time import of an old database), no
  dependencies to install

## Testing

Read this before running anything against the app. Someone already destroyed
live data here, and the way it happened is not obvious.

`make run` owns port 8791 and the real `data/family.json`. A POST to
`/api/tree` replaces the whole file, so a single stray request wipes
everything. Use a throwaway instance:

```bash
make test-server     # port 8799, .test-data/, your data untouched
make test-reset      # throw that data away
```

### Check what is answering before you write

This is the rule that matters, and the one that was missing. Aiming at a
different port is not enough, because a server that fails to bind leaves the
previous one answering on that port. That is exactly what went wrong: a test
server could not take 8791, nobody checked, and every request after it landed
in the real data.

So confirm the process holding the port is the one you started, and that it
points at the data file you meant:

```bash
pid=$(ss -lptn 'sport = :8799' | grep -oP 'pid=\K[0-9]+' | head -1)
tr '\0' '\n' < /proc/$pid/environ | grep FAMILY_TREE_DATA
# expected: FAMILY_TREE_DATA=.test-data/family.json
```

If that is not what you expect, stop. Do not send the request.

Four things now make this harder to get wrong, but none of them replace the
check above.

- The server refuses to start on a taken port, and binds before it touches
  any data, so a refused start creates nothing.
- The page talks to whichever server served it, so a page on 8799 cannot
  write to 8791.
- `FAMILY_TREE_PORT` and `FAMILY_TREE_DATA` mean a throwaway instance shares
  no state with the real one. Its backups go next to its own data file.
- The server refuses to start if the old `FAMILY_TREE_DB` is set, because it
  would ignore it and serve the real data.

### Treat data/ as read-only

Never `rm -rf data/`, and never assume it is absent because it was absent
earlier: someone may start their own server mid-session. To check the live
state, GET and read. To test against real data, copy the file and point a test
server at the copy:

```bash
cp data/family.json .test-data/family.json
```

If you do damage something, do not trust a check made after your own write.
Reading the file once your request has already overwritten it proves
nothing. Look in `data/backups/` first. The newest backup can miss up to a
day of edits. The browser `localStorage` copy under `familyTree.tree.v2`
is gone the moment the app saves again.

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

`make test` runs the chart layout on the example tree and on generated trees
of many shapes: more linked branches than the full search takes, parents with
no sex filled in, single parents, remarriages. It checks that everyone gets a
box, no boxes overlap and parents sit above their children. It needs node.
