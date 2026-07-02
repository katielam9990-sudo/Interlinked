"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"

type Stop = {
  at: number
  color: [number, number, number]
}

// Sky gradient color stops as scroll progress goes 0 -> 1.
// Bright cream daylight -> warm terracotta dusk -> deep olive night.
const TOP_STOPS: Stop[] = [
  { at: 0, color: [239, 231, 216] }, // cream daylight
  { at: 0.35, color: [221, 178, 138] }, // soft gold
  { at: 0.62, color: [150, 110, 92] }, // muted clay dusk
  { at: 0.82, color: [60, 64, 56] }, // twilight olive
  { at: 1, color: [26, 30, 26] }, // night #1a1e1a
]

const BOTTOM_STOPS: Stop[] = [
  { at: 0, color: [228, 234, 222] }, // cream
  { at: 0.35, color: [196, 123, 90] }, // terracotta
  { at: 0.62, color: [120, 92, 78] }, // clay
  { at: 0.82, color: [40, 46, 40] }, // deep olive
  { at: 1, color: [20, 23, 20] }, // night deep
]

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function sampleStops(stops: Stop[], p: number): string {
  let lower = stops[0]
  let upper = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (p >= stops[i].at && p <= stops[i + 1].at) {
      lower = stops[i]
      upper = stops[i + 1]
      break
    }
  }
  const span = upper.at - lower.at || 1
  const t = (p - lower.at) / span
  const r = Math.round(lerp(lower.color[0], upper.color[0], t))
  const g = Math.round(lerp(lower.color[1], upper.color[1], t))
  const b = Math.round(lerp(lower.color[2], upper.color[2], t))
  return `rgb(${r}, ${g}, ${b})`
}

// Deterministic seeded PRNG so the server and client render identical star
// fields (avoids hydration mismatches).
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260625)
const STAR_FIELD = Array.from({ length: 70 }, (_, i) => ({
  id: i,
  left: rand() * 100,
  top: rand() * 100,
  size: rand() * 2 + 1,
  delay: rand() * 4,
  duration: rand() * 3 + 3,
}))
const SECTIONS = [
  {
    eyebrow: "The age of consumption",
    title: "We consume more than we create",
    body: "Information moves through us constantly, but rarely through our minds. We scroll, absorb, and move on. Unsurprisingly, the ability to filter the world through our experiences, to make something new from what we've been given, is being quietly lost.",
  },
  {
    eyebrow: "Creation through connection",
    title: "But creation is what made us human.",
    body: "Before overconsumption, humans didn't hesitate to create connections. We named the animals we saw in the stars. We heard ourselves in the sound of the sea. We found ideas living inside another. This human ability to connect unconnected ideas is not a skill to learn. It is a skill to reclaim.",
  },
  {
    eyebrow: "The daily bridge",
    title: "Two minutes to claim new connections",
    body: "Each day, Interlinked presents a creator who will offer two ideas in the form of stars. The space between them is yours. Not to answer. Not to perform. To play. To explore a thought, draw a line, and find the connection that only you can find.",
  },
  {
    eyebrow: "Begin your practice",
    title: "Practice the art of connecting",
    body: "You don't need to be an artist, musician, or writer. Just practice making connections, and your voice will do the rest. Wake up from consumption hypnosis, and start creating. Today's bridge is waiting.",
  },
] 
// const SECTIONS = [
//   {
//     eyebrow: "Welcome to Interlinked",
//     title: "A commonplace for the mind",
//     body: "For centuries, thinkers kept commonplace books — pages where quotes, questions, and fragments of insight could live side by side. Interlinked is that practice, reimagined for the way you think today.",
//   },
//   {
//     eyebrow: "The idea",
//     title: "Every thought is a star",
//     body: "Nothing you notice exists in isolation. A line from a poem rhymes with a conversation; a question you asked years ago answers itself today. Here, each idea becomes a point of light waiting to be placed.",
//   },
//   {
//     eyebrow: "The practice",
//     title: "Draw the lines between them",
//     body: "Connection is the whole point. As you link one idea to another, soft green threads appear — a quiet constellation of how your mind actually moves. The map is yours, and it grows a little every day.",
//   },
//   {
//     eyebrow: "Begin",
//     title: "It starts with a single spark",
//     body: "Each day opens with one prompt — a Daily Spark — written to set your thinking in motion. Place your first star. The night sky is waiting.",
//   },
// ]

export function WelcomeExperience() {
  const [progress, setProgress] = useState(0)
  const frame = useRef(0)

  useEffect(() => {
    function onScroll() {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
        setProgress(p)
      })
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      cancelAnimationFrame(frame.current)
    }
  }, [])

  const topColor = useMemo(() => sampleStops(TOP_STOPS, progress), [progress])
  const bottomColor = useMemo(
    () => sampleStops(BOTTOM_STOPS, progress),
    [progress],
  )

  // Text shifts from dark (on bright sky) to light (on night sky).
  const textShift = Math.min(1, Math.max(0, (progress - 0.50) / 0.40))
  const darkText: [number, number, number] = [58, 67, 57]
  const lightText: [number, number, number] = [228, 234, 222]
  const textColor = `rgb(${Math.round(
    lerp(darkText[0], lightText[0], textShift),
  )}, ${Math.round(lerp(darkText[1], lightText[1], textShift))}, ${Math.round(
    lerp(darkText[2], lightText[2], textShift),
  )})`

  // Stars only appear as the sky darkens.
  const starOpacity = Math.min(1, Math.max(0, (progress - 0.55) / 0.35))
  // Sun/moon disc travels down and dims.
  const discY = lerp(18, 78, progress)
  const discOpacity = 1 - Math.min(1, Math.max(0, (progress - 0.7) / 0.25))

  return (
    <div className="relative">
      {/* Fixed scroll-driven sky */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-0 transition-none"
        style={{
          background: `linear-gradient(to bottom, ${topColor}, ${bottomColor})`,
        }}
      >
        {/* Sun setting into moon */}
        <div
          className="absolute left-1/2 -translate-x-1/2 rounded-full blur-[2px]"
          style={{
            top: `${discY}%`,
            width: "180px",
            height: "180px",
            opacity: discOpacity,
            background:
              "radial-gradient(circle at 50% 50%, rgba(255,236,205,0.95), rgba(217,152,115,0.55) 55%, rgba(217,152,115,0) 72%)",
          }}
        />
        {/* Star field */}
        <div
          className="absolute inset-0"
          style={{ opacity: starOpacity }}
          aria-hidden="true"
        >
          {STAR_FIELD.map((s) => (
            <span
              key={s.id}
              className="animate-twinkle absolute rounded-full"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                backgroundColor: "#dfeccf",
                boxShadow: "0 0 6px rgba(184,216,176,0.9)",
                animationDelay: `${s.delay}s`,
                animationDuration: `${s.duration}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5 md:px-12">
        <span
          className="font-serif text-2xl font-medium tracking-wide transition-colors duration-300"
          style={{ color: textColor }}
        >
          Interlinked
        </span>
        <Link
          href="/daily-spark"
          className="rounded-full border px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition-colors duration-300 hover:bg-white/10"
          style={{ color: textColor, borderColor: textColor }}
        >
          Daily Bridge
        </Link>
      </header>

      {/* Hero */}
      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p
          className="mb-6 text-xs font-medium uppercase tracking-[0.35em] transition-colors duration-300"
          style={{ color: textColor }}
        >
          A Digital Commonplace
        </p>
        <h1
          className="max-w-3xl text-balance font-serif text-5xl font-light leading-[1.05] transition-colors duration-300 md:text-7xl"
          style={{ color: textColor }}
        >
          INTERLINKED
        </h1>
        <p
          className="mt-7 max-w-xl text-pretty text-base leading-relaxed transition-colors duration-300 md:text-lg"
          style={{ color: textColor, opacity: 0.85 }}
        >
          Interlinked is a two-minute daily practice that turns what you read, watch, and feel into original thought. The practice aims to provide guidance in the discovery (or breaking!) of ideas, notions, and perspectives.
        </p>
         <p
          className="mt-7 max-w-xl text-pretty text-base leading-relaxed transition-colors duration-300 md:text-lg"
          style={{ color: textColor, opacity: 0.85 }}
        >
          It's a human ability to create. It's a human ability to connect. 
        </p>
        <div
          className="mt-16 flex flex-col items-center gap-2 transition-colors duration-300"
          style={{ color: textColor, opacity: 0.7 }}
        >
          <span className="text-[0.7rem] uppercase tracking-[0.3em]">
            Scroll to discover our mission.
          </span>
          <span className="h-10 w-px animate-pulse bg-current" />
        </div>
      </section>

      {/* Narrative sections */}
      {SECTIONS.map((section, i) => (
        <section
          key={section.title}
          className="relative z-10 flex min-h-screen items-center justify-center px-6 py-24"
        >
          <div
            className="max-w-xl text-center"
            style={{ 
              color: textColor,
              textShadow: progress > 0.45 ? `0 1px 12px rgba(0,0,0,${(progress - 0.45) * 1.5})` : 'none'
            }}
          >
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.3em] opacity-70">
              {section.eyebrow}
            </p>
            <h2 className="text-balance font-serif text-4xl font-light leading-tight md:text-5xl">
              {section.title}
            </h2>
            <p className="mx-auto mt-6 max-w-md text-pretty text-base leading-relaxed opacity-85 md:text-lg">
              {section.body}
            </p>
            {i === SECTIONS.length - 1 && (
              <Link
                href="/daily-spark"
                className="group mt-12 inline-flex items-center gap-3 rounded-full bg-[#b8d8b0] px-8 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-[#1a1e1a] shadow-[0_0_30px_rgba(184,216,176,0.35)] transition-all hover:shadow-[0_0_45px_rgba(184,216,176,0.6)]"
              >
                Enter Today's Bridge
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-1"
                >
                  &rarr;
                </span>
              </Link>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
