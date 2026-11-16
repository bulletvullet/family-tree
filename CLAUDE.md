# Family tree

Only the things that have already gone wrong here. Everything else is in
`README.md` or the code.

## Never test against the live app

`make run` owns **port 8791** and the real **`data/family.json`**. A POST to
`/api/tree` replaces the whole file, so one stray request wipes everything.
That has already happened.

```bash
make test-server     # port 8799, .test-data/, real data untouched
make test-reset      # delete that data
```

**Check what is answering before you write.** Aiming at another port is not
enough: a server that fails to bind leaves the previous one answering. That is
exactly how the data was lost. A test server could not take 8791, nobody
checked, every request after it hit the real data.

```bash
pid=$(ss -lptn 'sport = :8799' | grep -oP 'pid=\K[0-9]+' | head -1)
tr '\0' '\n' < /proc/$pid/environ | grep FAMILY_TREE_DATA
# expect: FAMILY_TREE_DATA=.test-data/family.json
```

Not what you expect? Stop. Do not send the request.

`data/` is read-only. Never `rm -rf` it, and never assume it is absent because
it was a minute ago, because the user starts their own server mid-session. To
test on real data, copy `data/family.json` into `.test-data/` and point a test
server at the copy. Keep `data/family.db`: it is the copy from before the
move to JSON.

If you do break it, a check made after your own write proves nothing: your
request has already overwritten the file. Look in `data/backups/` first, but
the newest backup can miss up to a day of edits. The other copy is
`localStorage` under `familyTree.tree.v2`, and the next save destroys it.

## Three ways broken code passes here

- `dispatchEvent(new MouseEvent('click'))` skips the pointer pipeline, so it
  passes on code a real click cannot reach. It hid a pointer-capture bug that
  made the entire chart unclickable. Use real input, such as
  `Input.dispatchMouseEvent` over the DevTools protocol.
- `node --check` only parses. It never checks that the names a file calls
  exist, which is how the public page shipped calls to two functions it did
  not define. Compare defined against used when moving code between `app.js`
  and `deploy/tree/tree.js`.
- The chart orders branches two ways: every order for up to six branches
  linked by marriage, one at a time beyond that. A real tree crosses from one
  to the other as it grows. The second way had a bug that no test data
  reached, and it blanked the whole chart once the user's tree passed six.
  `make test` generates trees of many sizes so both run. Run it after
  touching `chart.js`.

`make check` is a syntax gate. `make test` covers the chart layout only.

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
