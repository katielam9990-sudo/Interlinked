# bugs.md — Interlinked

Living bug + debt list. P1 = fix this month (launch-blocker), P2 = post-launch soon, P3 = someday/watch.
Walk the regression script (see month guide) after every canvas change; log what it turns up here.

---

## Open

### P1 — Edit-mode color menu appears too early, with no explanation
- **Symptom:** Commit a seed-1 idea, then double-click it to edit. The full color-bubble menu opens — including a seed-2 (green) color — even when the user has only been introduced to one side. No beacon/explanation of what the colors mean appears on this path.
- **Related:** The "only a connector can connect the two sides" nudge (fires when linking a green star to the orange seed) references "two sides" the user hasn't met yet at this stage — unhelpful wording out of context.
- **Where:** `onNodeDoubleClick` (unconnected branch flips node to `type: 'creating'`); `CreatingNode` bubble strip (`bubbleKinds`); color-hint gating (`colorHintState`, armed only in `createChoiceNode`).
- **Status:** Diagnosed. Two independent sub-bugs behind one symptom; the "two sides" nudge is downstream of sub-bug 1.
- **Root cause:** Not "the menu shouldn't show" — editing an unconnected star *should* bring the bubbles back (regression step: "Edit an unconnected star → bubbles return, color change works"). The real defects are (1) the menu's *contents* ignore the user's stage, and (2) the explanation beacon is welded to one code path.
- **Approach (agreed):**
  1. **Contents (sub-bug 1):** `bubbleKinds` is hardcoded to `['seed1','seed2', …]` — offers seed2 before it exists. Gate it by seed2-visibility, snapshotted into node `data` the same way `bridgeUnlocked` already is (set at the 3 build/edit spots: `createNode`, `createChoiceNode`, `onNodeDoubleClick`). Don't reach for live `seed2Visible` from inside `CreatingNode`; follow the existing snapshot rail.
  2. **Beacon (sub-bug 2):** The `hidden → pulsing` arming line lives only in `createChoiceNode`, so the edit path never arms it. Move arming into `CreatingNode` (every menu path renders it) via a `useEffect`: `if (bubbleKinds.length > 1 && hintState === 'hidden') armHint()`. Expose a new `armHint` through `ColorHintCtx` (twin of `dismissHint`), then **delete** the arming line from `createChoiceNode`.
  3. Effect dep array must list `bubbleKinds.length`, `hintState`, `armHint` (same exhaustive-deps discipline as the fix above).
- **Test:** Re-walk the full regression, especially "Edit an unconnected star" and the first-multicolor-menu encounter; confirm the "two sides" nudge no longer reachable before seed2 exists.

### P2 — Duplicated input-node handlers across three components
- **Symptom:** `StarNode`, `BridgeNode`, and `CreatingNode` each carry near-identical `onChange` / `onKeyDown` / `onBlur` + `justCreated` lifecycle logic, copy-pasted. Copies drift — the stale-`charCount` bug below existed in two of them but not the third.
- **Fix (deferred):** Extract shared input-node behavior into one `useInputNode` hook so a fix lands once. Do this on a Sunday review slot, not mid-launch — it forces a full regression re-walk.
- **Where:** `components/constellation-canvas_1.tsx` — `StarNode`, `BridgeNode`, `CreatingNode`.

---

## Fixed

### 2026-07-15 — Short drafts deleted on click-away (stale closure)
- **Symptom:** Type 1–9 chars in a new idea, click away → node deleted instead of nudging + keeping text. (Regression script step: "Type 4 chars, click away → nudge appears, text survives.")
- **Root cause:** `onBlur` read `data.charCount` but omitted it from the `useCallback` dependency array. Between 0 and 9 chars `isValid` never flips, so the callback never rebuilt and stayed closed over `charCount === 0`, hitting the delete branch.
- **Fix:** Added `data.charCount` to the dependency arrays of `StarNode.onBlur` and `BridgeNode.onBlur`. (`CreatingNode` already had it.)
- **Follow-up:** Turn on the `react-hooks/exhaustive-deps` ESLint rule — it flags exactly this class of bug automatically.
