-- Interlinked — insert the 3 workshopped prompts
-- Target: Supabase `prompts` table
-- Schema (from components/daily-spark.tsx › PromptRow):
--   id                 int (auto — do not set)
--   prompt_text        text
--   seed1_label        text
--   seed2_label        text
--   thinking_questions text[]     -- your "help questions"
--   citations          jsonb      -- [{ "text": ..., "author": ... }]  ← creator-card / creator notes
--
-- NOTE: the `citations` values below are PLACEHOLDERS. This is the part only you
-- can write — the source material that sparked each prompt + the meaning named on
-- the creator card (after the bridge). Replace each TODO before or right after running.
-- Run in the Supabase SQL editor; confirm "INSERT 0 3".

-- ── Prompt 1 — Speeding Up vs Slowing Down ─────────────────────────────
-- Using prompt line A (viability review leans A for wider three-bridges breadth).
-- Fallback B: 'You slowed down once and saw something you''d been outrunning. What were you speeding toward before that?'
insert into prompts (prompt_text, seed1_label, seed2_label, thinking_questions, citations)
values (
  'Name the season you couldn''t slow down — and the day you did.',
  'something you were chasing',
  'something you only saw once you''d stopped',
  array[
    'At what point did you decide you had to change pace?',
    'Did slowing down teach you how to speed up, or the other way around?',
    'Who or what was pushing the pace?',
    'Who were you in each moment?'
  ],
  '[
    {"text": "TODO — the source material that sparked this prompt (book/article/moment)", "author": "TODO"},
    {"text": "TODO — creator-card meaning: the trade between pace and presence, named after the bridge", "author": "Interlinked"}
  ]'::jsonb
);

-- ── Prompt 2 — The Power of Culture ────────────────────────────────────
insert into prompts (prompt_text, seed1_label, seed2_label, thinking_questions, citations)
values (
  'Someone handed you a script for how life was supposed to go. When did you first go off it?',
  'the life the script called for',
  'the moment you first went off it',
  array[
    'Who wrote the script — a parent, a religion, a whole hometown?',
    'The moment you went off it, whose voice did you hear first?',
    'Have you ever envied someone whose life looked "wrong" by your script?'
  ],
  '[
    {"text": "TODO — the source material that sparked this prompt", "author": "TODO"},
    {"text": "TODO — creator-card meaning: name \"the power of culture\" — the script was never neutral, it was handed to you", "author": "Interlinked"}
  ]'::jsonb
);

-- ── Prompt 3 — The Self You'll Never Be (Shadow / Non-Shadow) ──────────
insert into prompts (prompt_text, seed1_label, seed2_label, thinking_questions, citations)
values (
  'There is a version of yourself that you decided you''ll never be. When did you almost prove yourself wrong?',
  'something you''ve decided you''re "not the type" to do',
  'a moment that almost proved otherwise',
  array[
    'What did you do the last time someone suggested you try something out of character?',
    'Who first told you that you weren''t that kind of person?',
    'The moment it almost happened, how did you talk yourself back out of it?',
    'When did you catch yourself almost crossing a line you swore you''d never cross?'
  ],
  '[
    {"text": "TODO — the source material that sparked this prompt", "author": "TODO"},
    {"text": "TODO — creator-card meaning: the self-image edits out both your best and your grey; witnessing the edited-out part is self-knowledge, not judgment", "author": "Interlinked"}
  ]'::jsonb
);

-- Verify:
-- select id, prompt_text, seed1_label, seed2_label, thinking_questions, citations from prompts order by id desc limit 3;
