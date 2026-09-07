# Family tree

Only the things that have already gone wrong here. Everything else is in
`README.md` or the code.

## Never test against the live app

`make run` owns **port 8791** and the real **`data/family.db`**. A POST to
`/api/tree` replaces the whole tree in one transaction, so one stray request
wipes everything. That has already happened.

```bash
make test-server     # port 8799, .test-data/, real data untouched
make test-reset      # delete that database
```

**Check what is answering before you write.** Aiming at another port is not
enough: a server that fails to bind leaves the previous one answering. That is
exactly how the data was lost. A test server could not take 8791, nobody
checked, every request after it hit the real database.

```bash
pid=$(ss -lptn 'sport = :8799' | grep -oP 'pid=\K[0-9]+' | head -1)
tr '\0' '\n' < /proc/$pid/environ | grep FAMILY_TREE_DB
# expect: FAMILY_TREE_DB=.test-data/family.db
```

Not what you expect? Stop. Do not send the request.

`data/` is read-only. Never `rm -rf` it, and never assume it is absent because
it was a minute ago, because the user starts their own server mid-session. To
test a migration on the real schema, copy the file and point a test server at
the copy.

If you do break it, a check made after your own write proves nothing: your
request has already overwritten those pages. The only other copy is
`localStorage` under `familyTree.tree.v2`, and the next save destroys it.

## Two ways broken code passes here

- `dispatchEvent(new MouseEvent('click'))` skips the pointer pipeline, so it
  passes on code a real click cannot reach. It hid a pointer-capture bug that
  made the entire chart unclickable. Use real input, such as
  `Input.dispatchMouseEvent` over the DevTools protocol.
- `node --check` only parses. It never checks that the names a file calls
  exist, which is how the public page shipped calls to two functions it did
  not define. Compare defined against used when moving code between `app.js`
  and `deploy/tree/tree.js`.

`make check` is a syntax gate, not a test suite.

## Four things that are not obvious from the code

- **Kinship is never a string.** `app.js` emits descriptors like
  `{ k: 'anc', g: 2, fem: true }`; `i18n.js` renders them per language, because
  Russian separates `теща` from `свекровь` where English has one
  mother-in-law. A new relation means a descriptor plus a case in both
  renderers, never concatenated words.
- **`deploy/tree/` holds its own copies** of `i18n.js`, `chart.js` and
  `graph-bundle.js`. That folder ships alone and cannot reach its parent.
  `make sync` refreshes them; editing one copy only is a live failure mode.
- **Bump the `?v=` on changed script and style tags** in `index.html`, or the
  browser serves the stale file. This has cost a debugging round.
- **`SCHEMA` in `server.py` pairs with `NEEDS_SCHEMA` in `app.js`.** Bump both
  when the API gains a field the page needs. An old server accepts the write
  and drops fields it does not know, with no error anywhere, which is how a
  column of data went missing.
