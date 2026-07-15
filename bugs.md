# bugs.md — Interlinked

Living bug + debt list. P1 = fix this month (launch-blocker), P2 = post-launch soon, P3 = someday/watch.
Walk the regression script (see month guide) after every canvas change; log what it turns up here.

---

## Open

### P2 — Duplicated input-node handlers across three components
- **Symptom:** `StarNode`, `BridgeNode`, and `CreatingNode` each carry near-identical `onChange` / `onKeyDown` / `onBlur` + `justCreated` lifecycle logic, copy-pasted. Copies drift — the stale-`charCount` bug below existed in two of them but not the third.
- **Fix (deferred):** Extract shared input-node behavior into one `useInputNode` hook so a fix lands once. Do this on a Sunday review slot, not mid-launch — it forces a full regression re-walk.
- **Where:** `components/constellation-canvas_1.tsx` — `StarNode`, `BridgeNode`, `CreatingNode`.

### P3 — Beacon stays pulsing if never hovered
- **Symptom:** The color beacon only goes `pulsing → dismissed` on hover (`onMouseEnter` in `CreatingNode`). A user who sees it, picks a color, and never hovers leaves `hintState` at `pulsing`, so it auto-opens again on every later menu — now including edits, since arming became path-independent.
- **Fix idea:** Dismiss on first successful color-commit (`commitAs`), not only on hover. Small, post-launch.

### P3 — Unlink nudge (recolor a connected star) is easy to miss — watch, don't fix yet
- **Symptom:** Double-clicking a *connected* star fires "linked stars keep their color — unlink first to change it" through the ambient nudge overlay. It's subtle, and gated to once per session (`colorLockNudged`). It explains a non-event, off the bridge-completion critical path — low stakes.
- **Decision:** Not fixing now. Revisit after Week 2 live testing: if a real tester actually gets stuck trying to recolor a connected star, promote it; otherwise leave it subtle. Let observed behavior decide, not speculation.

---

## Fixed

### 2026-07-15 — Edit-mode color menu premature + unexplained
- **Symptom:** Editing a committed seed-1 star opened the full color menu (incl. seed-2) before seed2 existed, with no explanation; made the out-of-context "two sides" nudge reachable.
- **Root cause:** Two independent sub-bugs — (1) `bubbleKinds` was stage-blind (hardcoded seed1+seed2), (2) the beacon was armed only on the create path (`createChoiceNode`), never on edit.
- **Fix:** (1) Added a `seed2Available` snapshot to node `data` (set in `createChoiceNode` + `onNodeDoubleClick`) and gated the seed-2 bubble on it. (2) Moved beacon arming out of `createChoiceNode` into a `useEffect` in `CreatingNode` (`bubbleKinds.length > 1 && hintState === 'hidden'`), via a new `armHint` exposed through `ColorHintCtx`. "Two sides" nudge no longer reachable before seed2 exists.

### 2026-07-15 — Short drafts deleted on click-away (stale closure)
- **Symptom:** Type 1–9 chars in a new idea, click away → node deleted instead of nudging + keeping text. (Regression script step: "Type 4 chars, click away → nudge appears, text survives.")
- **Root cause:** `onBlur` read `data.charCount` but omitted it from the `useCallback` dependency array. Between 0 and 9 chars `isValid` never flips, so the callback never rebuilt and stayed closed over `charCount === 0`, hitting the delete branch.
- **Fix:** Added `data.charCount` to the dependency arrays of `StarNode.onBlur` and `BridgeNode.onBlur`. (`CreatingNode` already had it.)
- **Follow-up:** Turn on the `react-hooks/exhaustive-deps` ESLint rule — it flags exactly this class of bug automatically.
