"use client"

import Link from "next/link"
import { useCallback, useState } from "react"
import { ConstellationCanvas } from "@/components/constellation-canvas"

// --- Editable Daily Spark prompt + citations ---
// Edit these defaults directly to change what loads each day. The panel is also
// editable live in the UI for quick adjustments.
const DEFAULT_PROMPT =
  "What is something you believed deeply five years ago that you've since let go of — and what replaced it?"

const DEFAULT_SEEDS: Seed[] = [
  { text: "A belief you've released...", x: 380, y: 300 },
  { text: "What replaced it...", x: 720, y: 500 },
]

type Seed = {
  text: string
  x: number
  y: number
}

type Citation = {
  id: string
  text: string
  author: string
}

type Phase = 'intro' | 'prompt' | 'ready'

const DEFAULT_CITATIONS: Citation[] = [
  {
    id: "c1",
    text: "Today's spark drawn from a reflection on belief and change.",
    author: "Marcus Aurelius, Meditations",
  },
  {
    id: "c2",
    text: "We are what we repeatedly think; the constellation follows the thought.",
    author: "after Will Durant",
  },
]

const HELP_QUESTIONS = [
  "What's something you used to say with confidence that now makes you pause?",
  "What did you think adulthood would feel like — versus how it actually does?",
  "What's a rule you used to follow that you've quietly stopped following?",
  "What would your past self be most surprised to see you doing now?",
]

// Deterministic seeded PRNG so server and client render identical star fields.

export function DailySpark() {

  // Citation sidebar state
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [seeds, setSeeds] = useState<Seed[]>(DEFAULT_SEEDS)
  const [citations, setCitations] = useState<Citation[]>(DEFAULT_CITATIONS)
  const [editing, setEditing] = useState(false)
  const [phase, setPhase] = useState<Phase>('intro')
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpQuestions, setHelpQuestions] = useState(HELP_QUESTIONS)

  const [isCreator] = useState(() => {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('creator') === 'true'
  })

  const updateCitation = useCallback(
    (id: string, field: "text" | "author", value: string) => {
      setCitations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
      )
    },
    [],
  )

  const addCitation = useCallback(() => {
    setCitations((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: "New note or quotation…", author: "Author, Source" },
    ])
  }, [])

  const removeCitation = useCallback((id: string) => {
    setCitations((prev) => prev.filter((c) => c.id !== id))
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-night text-cream lg:flex-row">
      {/* Sidebar */}
      <aside
        className="flex w-full flex-col border-b border-white/10 px-7 py-7 lg:max-w-sm lg:border-b-0 lg:border-r"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 0%, #232a23 0%, #1a1e1a 45%, #141714 100%)",
        }}
      >
        {/* INTRO PHASE */}
        {phase === 'intro' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center animate-in fade-in duration-700">
            <p className="text-[0.65rem] uppercase tracking-[0.3em] text-sage">
              A new bridge awaits
            </p>
            <h2 className="max-w-xs text-balance font-serif text-2xl font-light leading-snug text-cream">
              Today&apos;s spark is ready
            </h2>
            <button
              type="button"
              onClick={() => setPhase('prompt')}
              className="group mt-4 flex items-center gap-2 text-sm font-medium uppercase tracking-[0.18em] text-spark transition-colors hover:text-cream"
            >
              Discover today&apos;s prompt
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </button>
          </div>
        )}

        {/* PROMPT PHASE */}
        {phase === 'prompt' && (
          <div className="mt-8 flex flex-1 flex-col animate-in fade-in slide-in-from-bottom-2 duration-700">
            <p className="text-[0.65rem] uppercase tracking-[0.3em] text-terracotta-soft">
              Today&apos;s prompt
            </p>
            <h1 className="mt-3 text-balance font-serif text-2xl font-light leading-snug text-cream">
              {prompt}
            </h1>
            <ul className="mt-8 space-y-4">
              {citations.map((c) => (
                <li key={c.id} className="border-l-2 border-olive-deep pl-4">
                  <figure>
                    <blockquote className="text-pretty text-sm leading-relaxed text-cream/85">
                      {c.text}
                    </blockquote>
                    <figcaption className="mt-1.5 font-serif text-sm italic text-sage">
                      &mdash; {c.author}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setPhase('ready')}
              className="group mt-auto flex items-center gap-2 text-sm font-medium uppercase tracking-[0.18em] text-spark transition-colors hover:text-cream"
            >
              Place your first star
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </button>
          </div>
        )}

        {/* READY PHASE */}
        {phase === 'ready' && (
          <div className="mt-8 flex flex-1 flex-col animate-in fade-in duration-500">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.3em] text-terracotta-soft">
                Today&apos;s prompt
              </p>
              {editing ? (
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="mt-3 w-full resize-none rounded-md border border-white/15 bg-white/5 p-3 font-serif text-xl leading-snug text-cream outline-none focus:border-spark/60"
                />
              ) : (
                <h1 className="mt-3 text-balance font-serif text-2xl font-light leading-snug text-cream">
                  {prompt}
                </h1>
              )}
            </div>

            <div className="mt-8 flex-1">
              <div className="flex items-center justify-between">
                <p className="text-[0.65rem] uppercase tracking-[0.3em] text-sage">Citations</p>
                {isCreator && (
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="rounded-full border border-white/20 px-3 py-1 text-[0.6rem] font-medium uppercase tracking-[0.18em] text-cream/80 transition-colors hover:bg-white/10"
                >
                  {editing ? "Done" : "Edit"}
                </button>
                )}
              </div>

              <ul className="mt-4 space-y-4">
                {citations.map((c) => (
                  <li key={c.id} className="border-l-2 border-olive-deep pl-4">
                    {isCreator && editing ? (
                      <div className="space-y-2">
                        <textarea
                          value={c.text}
                          onChange={(e) => updateCitation(c.id, "text", e.target.value)}
                          rows={2}
                          className="w-full resize-none rounded-md border border-white/15 bg-white/5 p-2 text-sm leading-relaxed text-cream/90 outline-none focus:border-spark/60"
                        />
                        <input
                          value={c.author}
                          onChange={(e) => updateCitation(c.id, "author", e.target.value)}
                          className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs italic text-sage outline-none focus:border-spark/60"
                        />
                        <button
                          type="button"
                          onClick={() => removeCitation(c.id)}
                          className="text-[0.65rem] uppercase tracking-[0.15em] text-clay transition-colors hover:text-terracotta-soft"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <figure>
                        <blockquote className="text-pretty text-sm leading-relaxed text-cream/85">
                          {c.text}
                        </blockquote>
                        <figcaption className="mt-1.5 font-serif text-sm italic text-sage">
                          &mdash; {c.author}
                        </figcaption>
                      </figure>
                    )}
                  </li>
                ))}
              </ul>

              {isCreator && editing && (
                <button
                  type="button"
                  onClick={addCitation}
                  className="mt-4 w-full rounded-md border border-dashed border-white/20 py-2 text-xs uppercase tracking-[0.18em] text-cream/70 transition-colors hover:bg-white/5"
                >
                  + Add citation
                </button>
              )}
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setHelpOpen((v) => !v)}
                className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.25em] text-sage/70 transition-colors hover:text-sage"
              >
                <span>{helpOpen ? '−' : '+'}</span>
                Need help thinking?
              </button>
              {helpOpen && (
                <ul className="mt-3 space-y-2 animate-in fade-in duration-300">
                  {helpQuestions.map((q, i) => (
                    <li key={i} className="border-l border-white/10 pl-3">
                      {isCreator && editing ? (
                        <div className="flex gap-2">
                          <input
                            value={q}
                            onChange={(e) =>
                              setHelpQuestions((prev) =>
                                prev.map((item, idx) => (idx === i ? e.target.value : item))
                              )
                            }
                            className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-cream/90 outline-none focus:border-spark/60"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setHelpQuestions((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            className="text-[0.65rem] uppercase tracking-[0.15em] text-clay transition-colors hover:text-terracotta-soft"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs leading-relaxed text-cream/60">{q}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {isCreator && editing && helpOpen && (
                <button
                  type="button"
                  onClick={() => setHelpQuestions((prev) => [...prev, "New question..."])}
                  className="mt-2 w-full rounded-md border border-dashed border-white/20 py-1.5 text-xs uppercase tracking-[0.18em] text-cream/70 transition-colors hover:bg-white/5"
                >
                  + Add question
                </button>
              )}
            </div>
            <p className="mt-6 text-xs leading-relaxed text-sage/80">
              Double click the sky to place an idea. Select one star, then another, to draw
              a line between them. Right click to delete stars/links. Double click a star to edit.
            </p>
          </div>
        )}
      </aside>

      {/* Canvas */}
      <section className="relative flex-1">
      <ConstellationCanvas
        key={phase === 'ready' ? 'active' : 'inactive'}
        seeds={phase === 'ready' ? seeds : []}
        />
      </section>
    </div>
  )
}
