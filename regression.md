# regression.md — Interlinked canvas

The 3-minute regression script. Run it after **every** canvas change, before starting the next one.
In order, no skipping — the order walks the same path a new user walks. A bug found one change
deep is trivial; a bug found five changes deep costs an evening.

**How this doc works**
- Every row is `action → expected result`. The `→` is the point: if you can't state the expected
  result, you can't tell pass from fail.
- Cover the wrong-turns (Escape, empty, invalid, click-away), not just the happy path — bugs live in the edges.
- Keep it fast. A regression you'd skip is worthless.
- It grows from bugs: when something slips past this script, add a row so it can never sneak back.
  Fixed items in `bugs.md` should graduate into rows here.

---

## Desktop (current)

### Create
- [ ] Double-click empty sky → input appears below the dot; underline grows as you type; glows at 10 chars
- [ ] Type 4 chars, press Enter → nudge appears, text survives
- [ ] Type 4 chars, click away → nudge appears, text survives (**not** deleted)  ← guards the stale-closure bug (2026-07-15)
- [ ] Valid text + color picked, click away → star commits exactly on the dot (no jump)
- [ ] Empty box, click away → box silently removed
- [ ] Escape mid-typing → new node removed / edited node restored

### Second seed + hints
- [ ] Second seed: bubble strip appears; beacon shows once; hover dims it; it stays hoverable
- [ ] Before seed2 exists, edit the first star → menu shows only the introduced color, no premature seed2 bubble ← guards the stage-gating bug (2026-07-15)

### Edit
- [ ] Edit an unconnected star → bubbles return; color change works; the color beacon explains the colors the first time; Escape restores original color AND text
- [ ] Edit a connected star → text-only edit; no dot jump; edges stay attached; unlink nudge fires (first time)

### Connect + complete
- [ ] Link two stars, complete a bridge → pulse, arrow, card all fire; replay works
- [ ] Press replay → the light-up starts promptly, no dead-air lag before it begins ← guards the reused-delay bug (2026-07-15)

### Persist
- [ ] Refresh the page → constellation restores (logged-in AND guest/incognito)

---

## Mobile (stub — build out in Week 3)

Not parity, survivability: create, connect, complete, no dead ends. Every desktop interaction that
relies on a mouse needs a touch equivalent — fill these in as the mobile interaction model lands.

### Touch equivalents to define
- [ ] Create a node — touch equivalent for **double-click empty sky** (tap? long-press? explicit "+"?)
- [ ] Edit a node — touch equivalent for **double-click a star**
- [ ] Delete a node/edge — touch equivalent for **right-click** (no context menu on touch)
- [ ] Hint beacon / bubble affordances — touch equivalent for **hover** (hover doesn't exist on touch)
- [ ] Link two stars — drag-to-connect works with a finger; target is big enough to hit

### Mobile happy path (mirror the desktop spine)
- [ ] Create two ideas on a phone → both commit, no lost text
- [ ] Link them and complete a bridge → pulse / arrow / card / replay all fire
- [ ] Refresh on mobile → constellation restores
- [ ] A stranger on a phone completes a bridge with no outside help (slower is fine; stuck is not)
