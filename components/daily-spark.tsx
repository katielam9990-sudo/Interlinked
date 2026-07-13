"use client"

import Link from "next/link"
import { useCallback, useState } from "react"
import { ConstellationCanvas } from "@/components/constellation-canvas_1"
// import { ConstellationCanvas_1 } from "./constellation-canvas_1"

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

type SocialLink = {
  id: string
  label: string
  url: string
}

type CreatorProfile = {
  name: string
  tagline: string
  imageUrl: string
  links: SocialLink[]
}

const DEFAULT_PROFILE: CreatorProfile = {
  name: "",
  tagline: "",
  imageUrl: "",
  links: []
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

type PromptRow = {
  prompt_text: string | null
  seed1_label: string | null
  seed2_label: string | null
  citations: { text: string; author: string }[] | null
  thinking_questions: string[] | null
}

export function DailySpark({ promptData }: { promptData: PromptRow | null }) {

  // Citation sidebar state
  const [prompt, setPrompt] = useState(promptData?.prompt_text ?? DEFAULT_PROMPT)
  const [seeds, setSeeds] = useState<Seed[]>(
    promptData?.seed1_label && promptData?.seed2_label
      ? [
          { text: promptData.seed1_label, x: 380, y: 300 },
          { text: promptData.seed2_label, x: 720, y: 500 },
        ]
      : DEFAULT_SEEDS
  )
  const [citations, setCitations] = useState<Citation[]>(() => {
    if (promptData?.citations?.length) {
        return promptData.citations.map((c, i) => ({ id: `c${i}`, ...c }))
      }
    return DEFAULT_CITATIONS
  })
  const [editing, setEditing] = useState(false)
  const [phase, setPhase] = useState<Phase>('intro')
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpQuestions, setHelpQuestions] = useState<string[]>(
    promptData?.thinking_questions ?? HELP_QUESTIONS
  )
  const [canvasKey, setCanvasKey] = useState(0)
  const [profile, setProfile] = useState<CreatorProfile>(DEFAULT_PROFILE)

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
        className="flex w-full flex-col border-b border-white/10 px-7 py-7 lg:max-w-sm lg:border-b-0 lg:border-r lg:h-screen lg:overflow-y-auto"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 0%, #232a23 0%, #1a1e1a 45%, #141714 100%)",
        }}
      >
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="font-serif text-xl font-medium text-cream/90 transition-colors hover:text-cream"
            >
              Interlinked
            </Link>
            <span className="text-[0.65rem] uppercase tracking-[0.25em] text-sage">
              Daily Bridge
            </span>
          </div>
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
                  onClick={() => {
                    if (editing) setCanvasKey((k) => k + 1)
                    setEditing((v) => !v)
                  }}
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
                <div className="mt-4">
                  <p className="text-[0.65rem] uppercase tracking-[0.3em] text-sage mb-2">Seeds</p>
                  {seeds.map((seed, i) => (
                    <input
                      key={i}
                      value={seed.text}
                      onChange={(e) =>
                        setSeeds((prev) =>
                          prev.map((s, idx) => idx === i ? { ...s, text: e.target.value } : s)
                        )
                      }
                      className="mb-2 w-full rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-cream/90 outline-none focus:border-spark/60"
                    />
                  ))}
                </div>
              )}

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
            {/* Creator Spotlight */}
            {(profile.name || (isCreator && editing)) && (
              <div className="mt-8 border-t border-white/10 pt-6">
                {isCreator && editing ? (
                  <div className="space-y-3">
                    <p className="text-[0.65rem] uppercase tracking-[0.3em] text-sage">Creator Profile</p>
                    <input
                      value={profile.imageUrl}
                      onChange={(e) => setProfile((p) => ({ ...p, imageUrl: e.target.value }))}
                      placeholder="Profile image URL"
                      className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-cream/90 outline-none focus:border-spark/60"
                    />
                    <input
                      value={profile.name}
                      onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Your name"
                      className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-cream/90 outline-none focus:border-spark/60"
                    />
                    <input
                      value={profile.tagline}
                      onChange={(e) => setProfile((p) => ({ ...p, tagline: e.target.value }))}
                      placeholder="One line about you"
                      className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-cream/90 outline-none focus:border-spark/60"
                    />
                    {profile.links.map((link) => (
                      <div key={link.id} className="flex gap-2">
                        <input
                          value={link.label}
                          onChange={(e) => setProfile((p) => ({
                            ...p,
                            links: p.links.map((l) => l.id === link.id ? { ...l, label: e.target.value } : l)
                          }))}
                          placeholder="Label"
                          className="w-1/3 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-cream/90 outline-none focus:border-spark/60"
                        />
                        <input
                          value={link.url}
                          onChange={(e) => setProfile((p) => ({
                            ...p,
                            links: p.links.map((l) => l.id === link.id ? { ...l, url: e.target.value } : l)
                          }))}
                          placeholder="URL"
                          className="flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-cream/90 outline-none focus:border-spark/60"
                        />
                        <button
                          type="button"
                          onClick={() => setProfile((p) => ({ ...p, links: p.links.filter((l) => l.id !== link.id) }))}
                          className="text-[0.65rem] text-clay hover:text-terracotta-soft"
                        >✕</button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, links: [...p.links, { id: crypto.randomUUID(), label: "", url: "" }] }))}
                      className="w-full rounded-md border border-dashed border-white/20 py-1.5 text-xs uppercase tracking-[0.18em] text-cream/70 transition-colors hover:bg-white/5"
                    >
                      + Add link
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    {profile.imageUrl ? (
                      <img
                        src={profile.imageUrl}
                        alt={profile.name}
                        className="h-12 w-12 flex-shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-olive-deep">
                        <span className="font-serif text-lg text-cream/70">{profile.name[0]}</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-serif text-base text-cream">{profile.name}</p>
                      {profile.tagline && (
                        <p className="mt-0.5 text-xs text-sage/80">{profile.tagline}</p>
                      )}
                      {profile.links.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-3">
                          {profile.links.map((link) => (
                            <a
                              key={link.id}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[0.65rem] uppercase tracking-[0.15em] text-spark/80 transition-colors hover:text-spark"
                            >
                              {link.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="mt-6 text-xs leading-relaxed text-sage/80">
              Double click the sky to place an idea. Select one star, then another, to draw
              a line between them. Right click to delete stars/links. Double click a star to edit.
            </p>
          </div>
        )}
      </aside>

      {/* Canvas */}
      <section className="relative flex-1 h-screen">
      {phase === 'ready' && (
        <ConstellationCanvas
          seed1Label={seeds[0].text}
          seed2Label={seeds[1].text}
        />
      )}
      </section>
    </div>
  )
}
