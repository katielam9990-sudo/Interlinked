# Interlinked — Day Plan · Thursday, July 16, 2026

*Week 1 (Jul 13–19) · Video 1 posts today · Three goals, no fixed priority — sequenced by energy*

Today isn't a build day (build days are Mon/Wed/Fri), so the calendar is yours to shape around three things: **film the research-drip video, load your three prompts into the database with their creator notes, and sit down with me to work through the bug/feedback backlog.** None outranks the others — so the plan orders them by *what each one demands of your head*, not importance. Creative-generative work (script + film) while you're fresh, mechanical work (database) in the mid-slump, open-ended thinking (strategy) when you want to talk it out.

One rule for the day: **each goal gets a "done enough" line so none of them silently eats the other two.** A half-filmed video, a half-loaded database, and a half-finished strategy doc is the failure mode. One-at-a-time, each to its own finish line.

---

## The schedule

### Morning — Video: choose → script → film (your freshest block)

You've picked the lane: **the neuroscience / DMN research drip** (the default-mode-network + aha-moment angle you staged yesterday), not the Socratic "Ways to Use" episode. Good call for today — the hook and rough script already exist in yesterday's plan, so this is a *finish-and-film*, not a *start-from-blank*. Save Socratic for when you have reps to teach from (your own note: practise-before-you-teach).

Three mini-goals, in order:

1. **Lock the topic + hook (15 min).** From the research folder, this video draws on `00-reality-is-constructed` / `01-mind-mapping` and the aha-moment article. Pick **one** hook from yesterday's three options and commit — don't keep all three open. (Recommendation: option 1, *"There's a specific brain network that lights up when you connect two unrelated ideas — and I accidentally built an app around it."* — it names the mechanism and the product in one breath.)
2. **Finalize the script (20–30 min).** Yesterday's ~30–40s script is 90% there. Read it aloud once, cut anything that doesn't sound like you, lock the on-screen text beats. Keep the claim on the *research*, not the app ("built on the science of," never "clinically proven").
3. **Film it (30–45 min).** Talking-head over a screen recording of a constellation forming, cico-buff register. Don't chase perfect — chase *posted-able*. One or two takes, pick the least-bad, done.

**Done enough:** a filmed take you'd actually post (editing/posting can slip to later today or tomorrow).

### Midday — Database: load the 3 prompts + creator notes (mechanical, lower-focus)

This is the perfect mid-day task — it's satisfying, finite, and doesn't need a fresh brain. Your three workshopped prompts (Speeding Up vs Slowing Down, The Power of Culture, The Self You'll Never Be) go into the Supabase `prompts` table.

I've written the insert SQL for you (`insert-prompts.sql`, shared below) — it maps each prompt to the real schema your app reads: `prompt_text`, `seed1_label`, `seed2_label`, `thinking_questions` (your help questions), and `citations` (this is where the **creator notes / source material** live — the `citations` array is exactly the creator-card content your `daily-spark` component renders).

Mini-goals:

1. **Run the insert (10 min).** Paste `insert-prompts.sql` into the Supabase SQL editor, run it, confirm 3 rows.
2. **Write the creator notes (30–40 min).** The SQL ships each prompt with placeholder citations — *this is the part only you can write.* For each prompt, the creator card needs: (a) the **source material that sparked it** (the book, article, moment), and (b) the **meaning named after the bridge** (Prompt 2's "the power of culture," Prompt 3's "witness, not judgment"). Your prompts doc already spells out the creator-card intent for 2 and 3 — turn those into 1–2 citation lines each.
3. **Spot-check in the app (10 min).** Load each prompt via `/bridge/[id]?creator=true`, confirm seeds, help questions, and citations render correctly.
4. **Resolve Prompt 1's open decision.** Prompt line **A vs B** — your viability review leans **A** (keeps the three-bridges breadth wider). The SQL uses A; change it if a read-aloud tells you otherwise.

**Done enough:** 3 prompts live in the DB, each with real (not placeholder) creator notes, verified rendering in the app.

### Afternoon — Strategize with me: bugs + feedback + workflow (open-ended, talk-it-out)

Bring me the open items and let's think together — this is a working session, not a solo grind. The raw material is already in your repo:

- **`bugs.md`** — 3 open items: P2 duplicated input-node handlers (the Sunday-refactor candidate), P3 pulsing beacon, P3 unlink-nudge (watch-don't-fix).
- **`regression.md`** — your 3-minute script; note the mobile section is still a stub for Week 3.
- **The feedback you've been given** — bring whatever tester/workflow notes you have; that's the input I don't have yet.

Mini-goals for the session:

1. **Dump the feedback (10 min).** Tell me the bugs/feedback you've received on the *workflow* — I'll help you sort signal from noise and slot each into P1/P2/P3.
2. **Decide the "workflow" theme (20 min).** Your canvas-todo already has two research-grounded workflow changes queued (require more generation per seed; self-Socratic depth). Let's pressure-test whether the feedback points at these or at something else, and what's a launch-blocker vs. post-launch.
3. **Leave with a sorted list (10 min).** Every item tagged P1/P2/P3 and either "next build day (Fri)" or "Sunday review" — so Friday's build block already knows what it's doing.

**Done enough:** feedback triaged into the priority tiers, and Friday's build target chosen.

---

## Sequencing logic (why this order)

- **Video first** because filming needs energy and daylight, and it's the one with a hard external clock (the drip cadence). Get it in the can before the day's friction accumulates.
- **Database midday** because it's the low-focus, high-satisfaction task — ideal for the post-lunch dip, and it doesn't compete with the video for creative fuel.
- **Strategy last** because it's collaborative and open-ended — better when you're ready to think out loud than when you're racing a shot list. It also naturally hands off to Friday's build day.

If energy runs short, protect the finish lines in this order: **film the video** (external clock) → **load the prompts** (unblocks testers seeing real content) → **strategy** (can flex to tomorrow; it only feeds Friday).

**Week-1 guardrail:** the guide's one real risk is burnout, not slippage. The drip is every 3–5 days, not daily — if you film today, you're ahead. Don't let "finish all three perfectly" turn a good day into a depleting one.

---

## Today's definition of done

- **Video:** topic + hook locked, script finalized, **one filmable take recorded** (posting can follow).
- **Database:** **3 prompts inserted** into Supabase, each with **real creator notes** (citations + meaning), rendering verified in-app.
- **Strategy:** bug/feedback list **triaged into P1/P2/P3**, **Friday's build target chosen.**
