"use client"

import { useCallback, useEffect, useState, useRef, useContext, createContext } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  getStraightPath,
  type EdgeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'


// ─── Types ────────────────────────────────────────────────────────────────────

type SeedSide = 'seed1' | 'seed2'

type InterlinkedNodeData = {
  text: string
  nodeType: 'seed' | 'star' | 'bridge'
  seedId: SeedSide | null          // derived from edges (source of truth once rooted)
  lockedSeed: SeedSide | null      // chosen at creation — locks an idea to one side
  depth: number
  glowState: 'none' | 'soft' | 'bright'
  charCount: number
  isValid: boolean
  subtreeCount: number
  activated: boolean
  visible: boolean
  selectedForBridge: boolean
  justCreated: boolean
  originalText?: string             // saved on double-click edit entry; restored on Escape/invalid-blur
  pendingKind: NodeKind | null      // color-bubble selection during 'creating' state
  bridgeUnlocked: boolean           // snapshot of isBridgeReady, taken at creation
  moved?: boolean                   // seed only — true once user-dragged; freezes it off the fractional layout
  [key: string]: unknown
  size?: number
}

type InterlinkedNode = Node<InterlinkedNodeData>
type InterlinkedEdge = Edge<{ dissolving?: boolean }>
type SnappingEdge = { sourceId: string; targetId: string; createdAt: number }
type CompletionPhase = 'idle' | 'pulsing' | 'done'
type ArrowState = 'hidden' | 'pulsing' | 'seen' | 'dismissed'
type NodeKind = 'seed1' | 'seed2' | 'bridge'
type CameraStage = 'seed1' | 'seed2' | 'zoomedOut'


// ─── Completion context ───────────────────────────────────────────────────────
// Propagates lit node IDs + completion phase into node components without
// prop drilling through React Flow's renderer.

const CompletionCtx = createContext<{ litIds: Set<string>; phase: CompletionPhase }>({
  litIds: new Set(),
  phase: 'idle',
})


// ─── Palette ──────────────────────────────────────────────────────────────────

const SEED1_COLOR = '#f5c842'   // orange
const SEED2_COLOR = '#8faa8b'   // green
const BRIDGE_COLOR = '#d4d0e8'  // lavender
const NEUTRAL_COLOR = 'rgba(228, 234, 222, 0.55)'  // undecided-kind dot/underline while typing

function kindColor(kind: NodeKind): string {
  if (kind === 'seed1') return SEED1_COLOR
  if (kind === 'seed2') return SEED2_COLOR
  return BRIDGE_COLOR
}

// Tiny hover-tooltip text for each bubble — deliberately never says "bridge"
function kindLabel(kind: NodeKind): string {
  if (kind === 'seed1') return 'this side'
  if (kind === 'seed2') return 'other side'
  return 'connects both'
}


// ─── Nudge context ────────────────────────────────────────────────────────────
// Lets node components (rendered inside React Flow's own tree) trigger the
// ambient gate-message overlay owned by CanvasInner, without prop drilling.

const NudgeCtx = createContext<{ nudge: (msg: string) => void }>({ nudge: () => {} })


// ─── Initial data ─────────────────────────────────────────────────────────────

const initialNodes: InterlinkedNode[] = [
  {
    id: 'seed1', type: 'seed', position: { x: 200, y: 300 }, draggable: false,
    data: {
      text: "A belief you've released...", nodeType: 'seed', seedId: 'seed1', lockedSeed: 'seed1',
      depth: 0, glowState: 'none', charCount: 0, isValid: false,
      subtreeCount: 0, activated: false, visible: true,
      selectedForBridge: false, justCreated: false,
      pendingKind: null, bridgeUnlocked: false, moved: false,
    }
  },
  {
    id: 'seed2', type: 'seed', position: { x: 600, y: 300 }, draggable: false,
    data: {
      text: "What replaced it...", nodeType: 'seed', seedId: 'seed2', lockedSeed: 'seed2',
      depth: 0, glowState: 'none', charCount: 0, isValid: false,
      subtreeCount: 0, activated: false, visible: false,
      selectedForBridge: false, justCreated: false,
      pendingKind: null, bridgeUnlocked: false, moved: false,
    }
  }
]

const initialEdges: InterlinkedEdge[] = []

// ─── Seed-reveal camera choreography ─────────────────────────────────────────
// Seeds sit at fixed fractional corners of the live canvas — deliberately far
// apart so the zoomed-out reveal reads as two distinct constellations, not a
// cluster. Fractions (not hardcoded pixels) keep correct margins at any
// viewport size.
const SEED_FRACTIONS: Record<SeedSide, { fx: number; fy: number }> = {
  seed1: { fx: 0.16, fy: 0.22 },
  seed2: { fx: 0.78, fy: 0.74 },
}
const SEED_STAGE_ZOOM = 1.35
// Zoomed-out is deliberately < 1 so each seed's branching stars have room to
// breathe once revealed.
const ZOOMED_OUT_ZOOM = 0.88
const CAMERA_DURATION = 1100
// A stage-advancing connection plays its own snap-flash first — give that a
// beat to register before the scripted pan starts, so the camera doesn't
// jump mid-animation.
const CAMERA_PAN_DELAY = 650


// ─── Pure utilities ───────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

// Single source of truth for node color — used by node components + SVG overlay.
// Falls back to lockedSeed so an idea shows its side color from birth, before
// it has been connected (and therefore before seedId is derived).
function getNodeColor(data: InterlinkedNodeData): string {
  if (data.nodeType === 'bridge') return BRIDGE_COLOR
  if (data.nodeType === 'seed') {
    return data.seedId === 'seed1' ? SEED1_COLOR : SEED2_COLOR
  }
  const side = data.seedId ?? data.lockedSeed
  if (side === 'seed1') {
    if (data.depth <= 1) return '#fde4b7'
    if (data.depth === 2) return '#f8e8c6'
    return '#ede9e0'
  }
  if (side === 'seed2') {
    if (data.depth <= 1) return '#d4f4cc'
    if (data.depth === 2) return '#dbfdd5'
    return '#e4e8e2'
  }
  return '#ede9e0'
}

function computeSeedGlowState(subtreeCount: number): 'none' | 'soft' | 'bright' {
  if (subtreeCount === 0) return 'none'
  if (subtreeCount === 1) return 'soft'
  return 'bright'
}

function computeGlowState(depth: number): 'none' | 'soft' | 'bright' {
  if (depth <= 1) return 'none'
  if (depth === 2) return 'soft'
  return 'bright'
}

function getDepth(id: string, nodes: InterlinkedNode[], edges: InterlinkedEdge[]): number {
  let depth = 0
  let currentId = id
  while (true) {
    const node = nodes.find(n => n.id === currentId)
    if (!node || node.data.nodeType === 'seed') return depth
    const parentEdge = edges.find(e => e.target === currentId)
    if (!parentEdge) return depth
    currentId = parentEdge.source
    depth += 1
  }
}

function getSeedId(id: string, nodes: InterlinkedNode[], edges: InterlinkedEdge[]): SeedSide | null {
  let currentId = id
  const guard = new Set<string>()
  while (true) {
    if (guard.has(currentId)) return null
    guard.add(currentId)
    const node = nodes.find(n => n.id === currentId)
    if (!node) return null
    if (node.data.nodeType === 'seed') return node.id as SeedSide
    const parentEdge = edges.find(e => e.target === currentId)
    if (!parentEdge) return null
    currentId = parentEdge.source
  }
}

function getSubtreeCount(id: string, nodes: InterlinkedNode[], edges: InterlinkedEdge[]): number {
  const node = nodes.find(n => n.id === id)
  if (!node || node.data.nodeType !== 'seed') return 0
  let count = 0
  for (const n of nodes) {
    if (n.data.nodeType !== 'star') continue
    if (getSeedId(n.id, nodes, edges) === id && n.data.isValid) count++
  }
  return count
}

function getStarSize(charCount: number): number {
  if (charCount >= 75) return 16
  if (charCount >= 50) return 15
  if (charCount >= 40) return 12
  return 10
}

// ─── Shared styles ────────────────────────────────────────────────────────────

// Pins handles to the center of the dot so edges connect there, not to the
// edge of React Flow's invisible node bounding box.
const centeredHandle: React.CSSProperties = {
  opacity: 0,
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 0,
  height: 0,
  minWidth: 0,
  minHeight: 0,
}


// ─── SeedNode ─────────────────────────────────────────────────────────────────

function SeedNode({ id, data }: NodeProps<InterlinkedNode>) {
  const [discovered, setDiscovered] = useState(false)
  const [pulseScale, setPulseScale] = useState(1)
  const { litIds } = useContext(CompletionCtx)
  const isLit = litIds.has(id)

  useEffect(() => {
    if (isLit) {
      setPulseScale(1.45)
      const t = setTimeout(() => setPulseScale(1), 700)
      return () => clearTimeout(t)
    }
  }, [isLit])

  if (!data.visible) return null

  const color = getNodeColor(data)
  const shadowBase = data.seedId === 'seed1' ? '245, 200, 66' : '143, 170, 139'
  const glowAmount = data.glowState === 'none' ? 5 : data.glowState === 'soft' ? 15 : 30
  const effectiveGlow = isLit ? glowAmount + 22 : glowAmount
  const dotOpacity = data.glowState === 'none' ? 0.5 : data.glowState === 'soft' ? 0.75 : 1

  return (
    <div
      style={{ position: 'relative', width: 12, height: 12 }}
      onMouseEnter={() => setDiscovered(true)}
    >
      {data.selectedForBridge && (
        <div style={{
          position: 'absolute', width: 28, height: 28, borderRadius: '50%',
          border: `1px solid rgba(${shadowBase}, 0.35)`,
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }} />
      )}
      <div style={{
        width: 12, height: 12, borderRadius: '50%',
        backgroundColor: color, opacity: dotOpacity,
        boxShadow: `0 0 ${effectiveGlow}px rgba(${shadowBase}, 0.9), 0 0 ${effectiveGlow * 2}px rgba(${shadowBase}, 0.4)`,
        transform: `scale(${pulseScale})`,
        transition: 'opacity 0.8s ease, box-shadow 0.8s ease, transform 0.55s ease',
      }} />

      {discovered && (
        <>
          <p style={{
            position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)',
            color, fontSize: '12px', whiteSpace: 'nowrap', pointerEvents: 'none',
            margin: 0,
          }}>
            {data.text}
          </p>
          <div style={{
            position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: '5px', alignItems: 'center',
          }}>
            {[0, 1].map((i) => (
              <div key={i} style={{
                width: 5, height: 5, borderRadius: '50%',
                flexShrink: 0,
                backgroundColor: i < data.subtreeCount ? color : 'transparent',
                boxShadow: `0 0 0 1px rgba(${shadowBase}, 0.5)`,
                transition: 'background-color 0.4s ease',
              }} />
            ))}
          </div>
        </>
      )}

      <Handle type="source" position={Position.Right} style={centeredHandle} />
      <Handle type="target" position={Position.Left} style={centeredHandle} />
    </div>
  )
}


// ─── StarNode ─────────────────────────────────────────────────────────────────

function StarNode({ data, id, dragging }: NodeProps<InterlinkedNode>) {
  const { setNodes } = useReactFlow()
  const [hovered, setHovered] = useState(false)
  const [displaySize, setDisplaySize] = useState(8)
  const [pulseScale, setPulseScale] = useState(1)
  const { litIds } = useContext(CompletionCtx)
  const isLit = litIds.has(id)

  useEffect(() => {
    if (isLit) {
      setPulseScale(1.45)
      const t = setTimeout(() => setPulseScale(1), 700)
      return () => clearTimeout(t)
    }
  }, [isLit])

  // After commit, animate dot from 8px base up to its final content-length size
  useEffect(() => {
    if (!data.justCreated && data.size) {
      const frame = requestAnimationFrame(() => setDisplaySize(data.size!))
      return () => cancelAnimationFrame(frame)
    }
  }, [data.justCreated, data.size])

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, text, charCount: text.length, isValid: text.length >= 10 } } : n
    ))
  }, [id, setNodes])

  useEffect(() => {
    if (data.justCreated) setHovered(false)
  }, [data.justCreated])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && data.isValid) {
      setNodes(nds => nds.map(n => n.id === id ? {
        ...n, draggable: true,
        data: { ...n.data, justCreated: false, originalText: undefined, size: getStarSize(n.data.charCount as number) }
      } : n))
    } else if (e.key === 'Escape') {
      if (data.originalText !== undefined) {
        // Editing an existing node — restore original instead of deleting
        const orig = data.originalText
        setNodes(nds => nds.map(n => n.id === id ? {
          ...n, draggable: true,
          data: { ...n.data, justCreated: false, originalText: undefined, text: orig, charCount: orig.length, isValid: orig.length >= 10 }
        } : n))
      } else {
        setNodes(nds => nds.filter(n => n.id !== id))
      }
    }
  }, [id, data.isValid, data.originalText, setNodes])

  const onBlur = useCallback(() => {
    if (data.originalText !== undefined) {
      // Editing — commit if valid, restore if the user wiped the text
      if (data.isValid) {
        setNodes(nds => nds.map(n => n.id === id ? {
          ...n, draggable: true,
          data: { ...n.data, justCreated: false, originalText: undefined, size: getStarSize(n.data.charCount as number) }
        } : n))
      } else {
        const orig = data.originalText
        setNodes(nds => nds.map(n => n.id === id ? {
          ...n, draggable: true,
          data: { ...n.data, justCreated: false, originalText: undefined, text: orig, charCount: orig.length, isValid: orig.length >= 10 }
        } : n))
      }
    } else {
      if (!data.isValid) setNodes(nds => nds.filter(n => n.id !== id))
    }
  }, [id, data.isValid, data.originalText, setNodes])

  const color = getNodeColor(data)
  const baseGlow = data.glowState === 'none' ? 5 : data.glowState === 'soft' ? 15 : 30
  const glowAmount = hovered ? baseGlow + 10 : baseGlow
  const effectiveGlow = isLit ? glowAmount + 22 : glowAmount
  const opacity = data.isValid ? 1 : 0.4

  if (data.justCreated) {
    return (
      <div className="relative flex flex-col items-center">
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          backgroundColor: color, opacity: 0.4, boxShadow: `0 0 8px ${color}`,
        }} />
        <input
          autoFocus value={data.text}
          onChange={onChange} onKeyDown={onKeyDown} onBlur={onBlur}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder={data.lockedSeed === 'seed2' ? 'A thought for this side...' : 'A thought for this side...'}
          style={{
            marginTop: 8, background: 'transparent', border: 'none',
            borderBottom: `1px solid ${color}`, color: '#e4eade',
            font: "13px 'Plus Jakarta Sans', sans-serif",
            outline: 'none', width: 200, textAlign: 'center',
          }}
        />
        <Handle type="target" position={Position.Left} style={centeredHandle} />
        <Handle type="source" position={Position.Right} style={centeredHandle} />
      </div>
    )
  }

  const finalSize = data.size ?? 9
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ position: 'relative', width: finalSize, height: finalSize }}>
        {data.selectedForBridge && (
          <div className="animate-ping absolute" style={{
            width: finalSize, height: finalSize, borderRadius: '50%',
            backgroundColor: color, opacity: 0.4,
          }} />
        )}
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: displaySize, height: displaySize,
          transform: `translate(-50%, -50%) scale(${pulseScale})`,
          borderRadius: '50%',
          backgroundColor: color, opacity,
          boxShadow: `0 0 ${effectiveGlow}px ${color}, 0 0 ${effectiveGlow * 2}px ${color}60`,
          transition: 'width 0.5s ease, height 0.5s ease, opacity 0.6s ease, box-shadow 0.6s ease, transform 0.55s ease',
        }} />
        <Handle type="target" position={Position.Left} style={centeredHandle} />
        <Handle type="source" position={Position.Right} style={centeredHandle} />
      </div>

      {(hovered || data.selectedForBridge || dragging) && (
        <p style={{
          position: 'absolute',
          top: finalSize + 6, left: '50%', transform: 'translateX(-50%)',
          color, opacity: 0.9, fontSize: '12px',
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          {data.text}
        </p>
      )}
    </div>
  )
}


// ─── CreatingNode ─────────────────────────────────────────────────────────────
// Double-click opens this immediately — a text input with small color bubbles
// beside it. The user types, picks a bubble (swappable until Enter), and only
// then can commit. On commit it becomes a real 'star' or 'bridge' node.

function CreatingNode({ id, data }: NodeProps<InterlinkedNode>) {
  const { setNodes } = useReactFlow()
  const { nudge } = useContext(NudgeCtx)
  const [hoveredKind, setHoveredKind] = useState<NodeKind | null>(null)

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, text, charCount: text.length, isValid: text.length >= 10 } } : n
    ))
  }, [id, setNodes])

  // Shared commit path — used by both the Enter key and a decisive bubble
  // click, so a bubble click that lands the second rooted idea for a seed
  // runs through the exact same node-commit shape either way.
  const commitAs = useCallback((kind: NodeKind) => {
    setNodes(nds => nds.map(n => {
      if (n.id !== id) return n
      if (kind === 'bridge') {
        return {
          ...n, type: 'bridge', draggable: true,
          data: { ...n.data, nodeType: 'bridge', justCreated: false, pendingKind: null, size: 13 }
        }
      }
      return {
        ...n, type: 'star', draggable: true,
        data: {
          ...n.data, nodeType: 'star', lockedSeed: kind as SeedSide,
          justCreated: false, pendingKind: null, size: getStarSize(n.data.charCount as number)
        }
      }
    }))
  }, [id, setNodes])

  // Clicking a bubble commits immediately if the text is already valid — a
  // decisive action on its own, no follow-up Enter needed. If the text isn't
  // valid yet, the click just marks the pending choice (shown with a ring)
  // until the text becomes valid, at which point either Enter or another
  // click on the (now ring-highlighted) bubble commits it.
  const selectKind = useCallback((kind: NodeKind) => {
    if (data.isValid) {
      commitAs(kind)
    } else {
      setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, pendingKind: kind } } : n))
    }
  }, [id, data.isValid, commitAs, setNodes])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (!data.pendingKind) {
        nudge('pick a color first')
        return
      }
      if (!data.isValid) return
      commitAs(data.pendingKind)
    } else if (e.key === 'Escape') {
      setNodes(nds => nds.filter(n => n.id !== id))
    }
  }, [id, data.isValid, data.pendingKind, commitAs, setNodes, nudge])

  const onBlur = useCallback(() => {
    if (!data.isValid) setNodes(nds => nds.filter(n => n.id !== id))
  }, [id, data.isValid, setNodes])

  const color = data.pendingKind ? kindColor(data.pendingKind) : NEUTRAL_COLOR
  const bubbleKinds: NodeKind[] = ['seed1', 'seed2', ...(data.bridgeUnlocked ? (['bridge'] as NodeKind[]) : [])]

  // Same column layout StarNode/BridgeNode use for justCreated — keeps the
  // dot anchored exactly at the double-click point. The bubble strip is an
  // absolutely-positioned overlay beside the input, so it doesn't shift that
  // anchor or the node's centering.
  return (
    <div className="relative flex flex-col items-center">
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        backgroundColor: color, opacity: data.pendingKind ? 0.6 : 0.35,
        boxShadow: `0 0 8px ${color}`,
        transition: 'background-color 0.2s ease, opacity 0.2s ease',
      }} />
      <div style={{ position: 'relative', marginTop: 8 }}>
        <input
          autoFocus value={data.text}
          onChange={onChange} onKeyDown={onKeyDown} onBlur={onBlur}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="What's the thought?"
          style={{
            background: 'transparent', border: 'none',
            borderBottom: `1px solid ${color}`, color: '#e4eade',
            font: "13px 'Plus Jakarta Sans', sans-serif",
            outline: 'none', width: 190, textAlign: 'center',
            transition: 'border-color 0.2s ease',
          }}
        />

        {/* Color bubbles — beside the input. Minimal: no menu chrome, just dots. */}
        <div style={{
          position: 'absolute', left: '100%', top: '50%',
          transform: 'translateY(-50%)', marginLeft: 10,
          display: 'flex', gap: 6, alignItems: 'center',
        }}>
          {bubbleKinds.map(kind => (
            <div
              key={kind}
              style={{ position: 'relative' }}
              onMouseEnter={() => setHoveredKind(kind)}
              onMouseLeave={() => setHoveredKind(prev => (prev === kind ? null : prev))}
            >
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={() => selectKind(kind)}
                style={{
                  width: 11, height: 11, borderRadius: '50%', padding: 0, cursor: 'pointer',
                  backgroundColor: kindColor(kind),
                  border: data.pendingKind === kind ? '1.5px solid #e4eade' : '1.5px solid transparent',
                  boxShadow: `0 0 6px ${kindColor(kind)}`,
                  opacity: data.pendingKind && data.pendingKind !== kind ? 0.4 : 1,
                  transition: 'opacity 0.15s ease, border-color 0.15s ease',
                }}
              />
              {hoveredKind === kind && (
                <p style={{
                  position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                  margin: 0, fontSize: 10, color: '#e4eade', opacity: 0.75,
                  whiteSpace: 'nowrap', pointerEvents: 'none',
                }}>
                  {kindLabel(kind)}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <Handle type="target" position={Position.Left} style={centeredHandle} />
      <Handle type="source" position={Position.Right} style={centeredHandle} />
    </div>
  )
}


// ─── BridgeNode ───────────────────────────────────────────────────────────────
// The connector node. Takes user input like a star, but is lavender and may
// link across both sides. Only created once bridge criteria are met.

function BridgeNode({ id, data, dragging }: NodeProps<InterlinkedNode>) {
  const { setNodes } = useReactFlow()
  const [hovered, setHovered] = useState(false)
  const [displaySize, setDisplaySize] = useState(8)
  const [pulseScale, setPulseScale] = useState(1)
  const { litIds } = useContext(CompletionCtx)
  const isLit = litIds.has(id)

  // Bridge pulses a touch more dramatically — it's the origin of the wave
  useEffect(() => {
    if (isLit) {
      setPulseScale(1.6)
      const t = setTimeout(() => setPulseScale(1), 900)
      return () => clearTimeout(t)
    }
  }, [isLit])

  useEffect(() => {
    if (!data.justCreated && data.size) {
      const frame = requestAnimationFrame(() => setDisplaySize(data.size!))
      return () => cancelAnimationFrame(frame)
    }
  }, [data.justCreated, data.size])

  useEffect(() => {
    if (data.justCreated) setHovered(false)
  }, [data.justCreated])

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, text, charCount: text.length, isValid: text.length >= 10 } } : n
    ))
  }, [id, setNodes])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && data.isValid) {
      setNodes(nds => nds.map(n => n.id === id ? {
        ...n, draggable: true,
        data: { ...n.data, justCreated: false, originalText: undefined, size: 13 }
      } : n))
    } else if (e.key === 'Escape') {
      if (data.originalText !== undefined) {
        const orig = data.originalText
        setNodes(nds => nds.map(n => n.id === id ? {
          ...n, draggable: true,
          data: { ...n.data, justCreated: false, originalText: undefined, text: orig, charCount: orig.length, isValid: orig.length >= 10 }
        } : n))
      } else {
        setNodes(nds => nds.filter(n => n.id !== id))
      }
    }
  }, [id, data.isValid, data.originalText, setNodes])

  const onBlur = useCallback(() => {
    if (data.originalText !== undefined) {
      if (data.isValid) {
        setNodes(nds => nds.map(n => n.id === id ? {
          ...n, draggable: true,
          data: { ...n.data, justCreated: false, originalText: undefined, size: 13 }
        } : n))
      } else {
        const orig = data.originalText
        setNodes(nds => nds.map(n => n.id === id ? {
          ...n, draggable: true,
          data: { ...n.data, justCreated: false, originalText: undefined, text: orig, charCount: orig.length, isValid: orig.length >= 10 }
        } : n))
      }
    } else {
      if (!data.isValid) setNodes(nds => nds.filter(n => n.id !== id))
    }
  }, [id, data.isValid, data.originalText, setNodes])

  const color = BRIDGE_COLOR

  if (data.justCreated) {
    return (
      <div className="relative flex flex-col items-center">
        <div style={{
          position: 'absolute',
          width: 20, height: 20, borderRadius: '50%',
          border: '1px solid rgba(212, 208, 232, 0.4)',
          top: 4, left: '50%', transform: 'translateX(-50%)',
        }} />
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          backgroundColor: color, opacity: 0.5, boxShadow: `0 0 10px ${color}`,
        }} />
        <input
          autoFocus value={data.text}
          onChange={onChange} onKeyDown={onKeyDown} onBlur={onBlur}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="The idea that connects both sides..."
          style={{
            marginTop: 10, background: 'transparent', border: 'none',
            borderBottom: `1px solid ${color}`, color: '#e4eade',
            font: "13px 'Plus Jakarta Sans', sans-serif",
            outline: 'none', width: 220, textAlign: 'center',
          }}
        />
        <Handle type="target" position={Position.Left} style={centeredHandle} />
        <Handle type="source" position={Position.Right} style={centeredHandle} />
      </div>
    )
  }

  const finalSize = data.size ?? 13
  const glowAmount = hovered ? 28 : 14
  const effectiveGlow = isLit ? glowAmount + 22 : glowAmount

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Outer ring — visually marks the bridge as the connector node */}
      <div style={{
        position: 'absolute',
        width: finalSize + 12, height: finalSize + 12,
        borderRadius: '50%',
        border: '1px solid rgba(212, 208, 232, 0.3)',
        top: '50%', left: '50%',
        transform: `translate(-50%, -50%) scale(${pulseScale})`,
        transition: 'transform 0.55s ease',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', width: finalSize, height: finalSize }}>
        {data.selectedForBridge && (
          <div className="animate-ping absolute" style={{
            width: finalSize, height: finalSize, borderRadius: '50%',
            backgroundColor: color, opacity: 0.3,
          }} />
        )}
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: displaySize, height: displaySize,
          transform: `translate(-50%, -50%) scale(${pulseScale})`,
          borderRadius: '50%',
          backgroundColor: color,
          boxShadow: `0 0 ${effectiveGlow}px rgba(212, 208, 232, 0.9), 0 0 ${effectiveGlow * 2}px rgba(212, 208, 232, 0.4)`,
          transition: 'width 0.5s ease, height 0.5s ease, box-shadow 0.6s ease, transform 0.55s ease',
        }} />
        <Handle type="target" position={Position.Left} style={centeredHandle} />
        <Handle type="source" position={Position.Right} style={centeredHandle} />
      </div>

      {(hovered || dragging) && (
        <p style={{
          position: 'absolute',
          top: finalSize + 8, left: '50%', transform: 'translateX(-50%)',
          color, opacity: 0.8, fontSize: '12px',
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          {data.text}
        </p>
      )}
    </div>
  )
}


// ─── InterlinkedEdge ──────────────────────────────────────────────────────────

function InterlinkedEdge({ sourceX, sourceY, targetX, targetY, style }: EdgeProps) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  return (
    <>
      {/* Invisible 20px hit area — makes right-click actually catchable */}
      <path d={edgePath} strokeWidth={20} stroke="transparent" fill="none" pointerEvents="all" />
      {/* Visible line */}
      <path d={edgePath} style={style} fill="none" />
    </>
  )
}

const edgeTypes = { interlinked: InterlinkedEdge }
const nodeTypes: NodeTypes = { seed: SeedNode, star: StarNode, bridge: BridgeNode, creating: CreatingNode }


// ─── Canvas inner ─────────────────────────────────────────────────────────────

function CanvasInner({ seed1Label, seed2Label, onSnapshot, savedNodes, savedEdges }: { seed1Label: string; seed2Label: string; onSnapshot?: (nodes: unknown, edges: unknown) => void; savedNodes?: InterlinkedNode[] | null; savedEdges?: InterlinkedEdge[] | null}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<InterlinkedNode>(
    savedNodes && savedNodes.length > 0
    ? savedNodes : [
    {
      id: 'seed1', type: 'seed', position: { x: 200, y: 300 }, draggable: false,
      data: {
        text: seed1Label, nodeType: 'seed', seedId: 'seed1', lockedSeed: 'seed1',
        depth: 0, glowState: 'none', charCount: 0, isValid: false,
        subtreeCount: 0, activated: false, visible: true,
        selectedForBridge: false, justCreated: false,
        pendingKind: null, bridgeUnlocked: false, moved: false,
      }
    },
    {
      id: 'seed2', type: 'seed', position: { x: 600, y: 300 }, draggable: false,
      data: {
        text: seed2Label, nodeType: 'seed', seedId: 'seed2', lockedSeed: 'seed2',
        depth: 0, glowState: 'none', charCount: 0, isValid: false,
        subtreeCount: 0, activated: false, visible: false,
        selectedForBridge: false, justCreated: false,
        pendingKind: null, bridgeUnlocked: false, moved: false,
      }
    }
  ])
  const [edges, setEdges, onEdgesChange] = useEdgesState<InterlinkedEdge>(
    savedEdges && savedEdges.length > 0 ? savedEdges : initialEdges
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const [pendingAnchorPos, setPendingAnchorPos] = useState({ x: 0, y: 0 })
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [snappingEdges, setSnappingEdges] = useState<SnappingEdge[]>([])
  const [gateMessage, setGateMessage] = useState<string | null>(null)
  const [completionPhase, setCompletionPhase] = useState<CompletionPhase>('idle')
  const [litNodeIds, setLitNodeIds] = useState<Set<string>>(new Set())
  const [completionFlashEdges, setCompletionFlashEdges] = useState<SnappingEdge[]>([])
  const completionTriggered = useRef(false)
  const completionBridgeId = useRef<string | null>(null)
  const [arrowState, setArrowState] = useState<ArrowState>('hidden')
  const [arrowTextVisible, setArrowTextVisible] = useState(false)
  const [isArrowHovered, setIsArrowHovered] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)
  const [cardFace, setCardFace] = useState<'front' | 'back'>('front')
  const [showReplay, setShowReplay] = useState(false)
  const [cameraStage, setCameraStage] = useState<CameraStage>('seed1')
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const { screenToFlowPosition, getViewport, setViewport, fitView } = useReactFlow()
  const isEditingNode = nodes.some(n => n.data.justCreated)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes   

  // Gentle nudge — reuses the ambient gateMessage slot, e.g. "pick a color first"
  const nudge = useCallback((msg: string) => {
    setGateMessage(msg)
    setTimeout(() => setGateMessage(null), 2000)
  }, [])


  // ── Seed-reveal camera choreography ─────────────────────────────────────────

  // Measure the live canvas size so seed fractional positions hold correct
  // margins at any viewport size.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setCanvasSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep each seed pinned to its fractional corner (and locked from dragging)
  // until the user actually drags it — which is only possible once
  // cameraStage reaches 'zoomedOut'. Once moved, it's fully user-controlled
  // and never snaps back.
  useEffect(() => {
    if (!canvasSize.width || !canvasSize.height) return
    setNodes(nds => nds.map(n => {
      if (n.data.nodeType !== 'seed') return n
      const draggable = cameraStage === 'zoomedOut'
      if (n.data.moved) {
        return n.draggable === draggable ? n : { ...n, draggable }
      }
      const { fx, fy } = SEED_FRACTIONS[n.id as SeedSide]
      return { ...n, draggable, position: { x: fx * canvasSize.width, y: fy * canvasSize.height } }
    }))
  }, [canvasSize, cameraStage, setNodes])

  // Freeze a seed's position once the user drags it (only reachable once
  // draggable, i.e. once zoomedOut) — no more snapping to the fraction.
  const onNodeDragStop = useCallback((_e: MouseEvent | TouchEvent, node: InterlinkedNode) => {
    if (node.data.nodeType === 'seed' && !node.data.moved) {
      setNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, moved: true } } : n))
    }
  }, [setNodes])

  // A stage only advances once a seed has 2 valid, rooted descendants — at
  // any depth (reuses getSubtreeCount, which already walks the full chain).
  // Depends on the whole nodes/edges state so it recomputes after both a
  // text commit AND a new edge — not just one or the other.
  useEffect(() => {
    setCameraStage(prev => {
      if (prev === 'seed1' && getSubtreeCount('seed1', nodes, edges) >= 2) return 'seed2'
      if (prev === 'seed2' && getSubtreeCount('seed2', nodes, edges) >= 2) return 'zoomedOut'
      return prev
    })
  }, [nodes, edges])

  // World-point-centering formula: translateX = W/2 - px*Z, translateY = H/2 - py*Z
  //
  // For the seed1/seed2 stages, seeds are always exactly at their fractional
  // corner (they're undraggable then), so we compute that directly from
  // canvasSize rather than reading node.position — avoids a stale-closure
  // race against the effect that syncs seed position to canvasSize (both
  // fire off the same canvasSize change, but this one shouldn't have to wait
  // for that one to land first). Only zoomedOut needs the live node position,
  // since seeds become draggable there.
  const computeCameraTarget = useCallback((stage: CameraStage) => {
    if (!canvasSize.width || !canvasSize.height) return null
    const W = canvasSize.width, H = canvasSize.height
    const centerOn = (px: number, py: number, zoom: number) => ({ x: W / 2 - px * zoom, y: H / 2 - py * zoom, zoom })
    const fractionalPos = (side: SeedSide) => {
      const { fx, fy } = SEED_FRACTIONS[side]
      return { x: fx * W, y: fy * H }
    }
    if (stage === 'seed1') { const p = fractionalPos('seed1'); return centerOn(p.x, p.y, SEED_STAGE_ZOOM) }
    if (stage === 'seed2') { const p = fractionalPos('seed2'); return centerOn(p.x, p.y, SEED_STAGE_ZOOM) }
    const seed1 = nodes.find(n => n.id === 'seed1')
    const seed2 = nodes.find(n => n.id === 'seed2')
    const p1 = seed1?.data.moved ? seed1.position : fractionalPos('seed1')
    const p2 = seed2?.data.moved ? seed2.position : fractionalPos('seed2')
    const midX = (p1.x + p2.x) / 2
    const midY = (p1.y + p2.y) / 2
    return centerOn(midX, midY, ZOOMED_OUT_ZOOM)
  }, [nodes, canvasSize])

  // Sets the viewport ONLY at the moment cameraStage actually transitions —
  // never on every render — so React Flow's normal pan/zoom controls are
  // never fought once a scripted move has settled (including after
  // zoomedOut, where the user's own pan/zoom takes over for good).
  //
  // Real transitions (not the initial mount) are held back by
  // CAMERA_PAN_DELAY so the connection that triggered the advance gets to
  // play its snap-flash before the camera starts moving out from under it.
  //
  // pannedStageRef is only updated once the pan actually FIRES (inside the
  // timeout), not when it's merely scheduled. computeCameraTarget's identity
  // — and therefore this effect — can legitimately re-run one more time
  // shortly after a stage change (e.g. the derived-node-data effect updating
  // `nodes` right after the new edge lands). If we'd marked the stage as
  // "handled" synchronously, that re-run's cleanup would cancel the pending
  // timer and the early-return guard would then block ever rescheduling it —
  // the pan would silently never happen. Rescheduling instead just debounces
  // to the last relevant change, which is what a stray reschedule should do.
  const pannedStageRef = useRef<CameraStage | null>(null)
  useEffect(() => {
    if (pannedStageRef.current === cameraStage) return
    const target = computeCameraTarget(cameraStage)
    if (!target) return
    if (pannedStageRef.current === null) {
      pannedStageRef.current = cameraStage
      setViewport(target, { duration: 0 })
      return
    }
    const t = setTimeout(() => {
      pannedStageRef.current = cameraStage
      setViewport(target, { duration: CAMERA_DURATION })
    }, CAMERA_PAN_DELAY)
    return () => clearTimeout(t)
  }, [cameraStage, computeCameraTarget, setViewport])


  // Recompute all derived node data whenever edges change.
  // Reveals seed2 once seed1 reaches activated state (subtreeCount >= 2).
  useEffect(() => {
    setNodes(nds => {
      const updated = nds.map(node => {
        if (node.data.nodeType === 'seed') {
          const subtreeCount = getSubtreeCount(node.id, nds, edges)
          const glowState = computeSeedGlowState(subtreeCount)
          return { ...node, data: { ...node.data, subtreeCount, activated: subtreeCount >= 2, glowState } }
        } else {
          const depth = getDepth(node.id, nds, edges)
          const seedId = getSeedId(node.id, nds, edges)
          const glowState = computeGlowState(depth)
          return { ...node, data: { ...node.data, depth, seedId, glowState } }
        }
      })
      const seed1 = updated.find(n => n.id === 'seed1')
      if (seed1?.data.activated) {
        return updated.map(n => n.id === 'seed2' ? { ...n, data: { ...n.data, visible: true } } : n)
      }
      return updated
    })
  }, [edges])

  // Debounced autosave — waits for 2s of quiet before snapshotting
  useEffect(() => {
    if (!onSnapshot) return
    const timer = setTimeout(() => onSnapshot(nodes, edges), 2000)
    return () => clearTimeout(timer)
  }, [nodes, edges, onSnapshot])

  // ── Completion pulse ────────────────────────────────────────────────────────
  // BFS wave from the bridge node outward. The zoom-out runs FIRST and settles;
  // only then does the wave travel, so the SVG strobe lines don't jump around
  // while the viewport is still animating.
  const triggerCompletionPulse = useCallback((
    originId: string,
    allNodes: InterlinkedNode[],
    allEdges: InterlinkedEdge[],
    onComplete?: () => void
  ) => {
    completionTriggered.current = true
    setCompletionPhase('pulsing')

    const ZOOM_DURATION = 900
    const FIT_VIEW_DELAY = 1500
    const PULSE_START_DELAY = FIT_VIEW_DELAY + ZOOM_DURATION + 150   // let the zoom fully settle first

    // Zoom out to reveal the whole constellation
    setTimeout(() => fitView({ duration: ZOOM_DURATION, padding: 0.35 }), FIT_VIEW_DELAY)

    // BFS: build layer-by-layer order from the origin
    const layers: string[][] = [[originId]]
    const visited = new Set([originId])
    while (true) {
      const current = layers[layers.length - 1]
      const next: string[] = []
      for (const nodeId of current) {
        for (const edge of allEdges) {
          const neighbor =
            edge.source === nodeId ? edge.target :
            edge.target === nodeId ? edge.source : null
          if (neighbor && !visited.has(neighbor)) {
            next.push(neighbor)
            visited.add(neighbor)
          }
        }
      }
      if (next.length === 0) break
      layers.push(next)
    }

    const LAYER_DELAY = 350
    let flashCounter = 0

    layers.forEach((layer, layerIndex) => {
      setTimeout(() => {
        setLitNodeIds(prev => {
          const next = new Set(prev)
          layer.forEach(id => next.add(id))
          return next
        })

        if (layerIndex > 0) {
          const prevLayer = layers[layerIndex - 1]
          const newFlashEdges: SnappingEdge[] = []
          for (const nodeId of layer) {
            for (const prevId of prevLayer) {
              const connected = allEdges.some(e =>
                (e.source === prevId && e.target === nodeId) ||
                (e.source === nodeId && e.target === prevId)
              )
              if (connected) {
                newFlashEdges.push({
                  sourceId: prevId,
                  targetId: nodeId,
                  createdAt: Date.now() + (flashCounter++ * 7),
                })
              }
            }
          }
          if (newFlashEdges.length > 0) {
            setCompletionFlashEdges(prev => [...prev, ...newFlashEdges])
          }
        }
      }, PULSE_START_DELAY + layerIndex * LAYER_DELAY)
    })

    setTimeout(
      () => { setCompletionPhase('done'); onComplete?.() },
      PULSE_START_DELAY + layers.length * LAYER_DELAY + 900
    )
  }, [fitView])


  // Watch for the moment a bridge node connects to both seed chains
  useEffect(() => {
    if (completionPhase !== 'idle' || completionTriggered.current) return
    const bridgeNodes = nodes.filter(n => n.data.nodeType === 'bridge' && !n.data.justCreated)
    if (bridgeNodes.length === 0) return

    for (const bridgeNode of bridgeNodes) {
      const connectedSeedIds = new Set<string>()
      for (const edge of edges) {
        const otherId =
          edge.source === bridgeNode.id ? edge.target :
          edge.target === bridgeNode.id ? edge.source : null
        if (otherId) {
          const seedId = getSeedId(otherId, nodes, edges)
          if (seedId) connectedSeedIds.add(seedId)
        }
      }
      if (connectedSeedIds.size >= 2) {
        completionBridgeId.current = bridgeNode.id
        triggerCompletionPulse(bridgeNode.id, nodes, edges)
        return
      }
    }
  }, [nodes, edges, completionPhase, triggerCompletionPulse])


  // Once the pulse fully settles, reveal the arrow prompt (first time only)
  useEffect(() => {
    if (completionPhase === 'done' && arrowState === 'hidden') {
      const t = setTimeout(() => setArrowState('pulsing'), 600)
      return () => clearTimeout(t)
    }
  }, [completionPhase, arrowState])

  // Replay the BFS pulse without retriggering the arrow/card sequence
  const handleReplay = useCallback(() => {
    if (!completionBridgeId.current) return
    setShowReplay(false)
    setLitNodeIds(new Set())
    setCompletionFlashEdges([])
    triggerCompletionPulse(completionBridgeId.current, nodes, edges, () => {
      setShowReplay(true)
    })
  }, [nodes, edges, triggerCompletionPulse])


  // Track cursor position — drives the rubber-band line while pending
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [pendingSourceId])


  // Seed2 becomes visible once seed1 is activated
  const seed2Visible = !!nodes.find(n => n.id === 'seed2')?.data.visible

  // Bridge access: both seeds activated AND at least one side has reached depth 2
  const isBridgeReady = (() => {
    const seed1 = nodes.find(n => n.id === 'seed1')
    const seed2 = nodes.find(n => n.id === 'seed2')
    if (!seed1?.data.activated || !seed2?.data.activated) return false
    return nodes.some(n =>
      n.data.nodeType === 'star' && getDepth(n.id, nodes, edges) >= 2
    )
  })()


  // The side a node belongs to: seeds → own id, bridge → null (spans), idea → its locked side
  const nodeSide = useCallback((node: InterlinkedNode): SeedSide | null => {
    if (node.data.nodeType === 'seed') return node.id as SeedSide
    if (node.data.nodeType === 'bridge') return null
    return node.data.lockedSeed ?? getSeedId(node.id, nodes, edges)
  }, [nodes, edges])

  const isRooted = useCallback((id: string) =>
    getSeedId(id, nodes, edges) !== null, [nodes, edges])


  // Fast path: before seed2 exists there's only one possible kind (seed1's
  // idea), so skip the bubble choice entirely and create it directly.
  const createNode = useCallback((kind: SeedSide, flow: { x: number; y: number }) => {
    setNodes(nds => [...nds, {
      id: uid(), type: 'star', position: flow, draggable: false,
      data: {
        text: '', nodeType: 'star', seedId: null, lockedSeed: kind, depth: 1,
        glowState: 'none', charCount: 0, isValid: false, subtreeCount: 0,
        activated: false, visible: true, selectedForBridge: false, justCreated: true,
        pendingKind: null, bridgeUnlocked: false, size: 8,
      }
    }])
  }, [setNodes])

  // General path: text input opens immediately, color bubbles sit beside it.
  // The kind (and therefore the node's eventual type/color) isn't decided
  // until a bubble is clicked — see CreatingNode.
  const createChoiceNode = useCallback((flow: { x: number; y: number }) => {
    setNodes(nds => [...nds, {
      id: uid(), type: 'creating', position: flow, draggable: false,
      data: {
        text: '', nodeType: 'star', seedId: null, lockedSeed: null, depth: 1,
        glowState: 'none', charCount: 0, isValid: false, subtreeCount: 0,
        activated: false, visible: true, selectedForBridge: false, justCreated: true,
        pendingKind: null, bridgeUnlocked: isBridgeReady, size: 8,
      }
    }])
  }, [setNodes, isBridgeReady])


  // Double-click empty canvas:
  //   — before seed2 exists → create a seed1 idea directly (only one option)
  //   — otherwise → open the input + color-bubble strip in place
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (nodesRef.current.some(n => n.data.justCreated)) return
    if (completionPhase === 'pulsing') return
    if (cardOpen) return
    if (!(e.target as Element).classList.contains('react-flow__pane')) return
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })

    if (!seed2Visible) {
      createNode('seed1', flow)
      return
    }
    createChoiceNode(flow)
  }, [completionPhase, screenToFlowPosition, seed2Visible, createNode, createChoiceNode])


  // Click node → two-click linking with side-locking enforcement
  const onNodeClick = useCallback((e: React.MouseEvent, node: InterlinkedNode) => {
    if (node.data.justCreated) return

    if (pendingSourceId === null) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) setPendingAnchorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      setPendingSourceId(node.id)
      setNodes(nds => nds.map(n =>
        n.id === node.id ? { ...n, data: { ...n.data, selectedForBridge: true } } : n
      ))
      return
    }

    if (pendingSourceId === node.id) {
      // Clicked same node again — cancel
      setPendingSourceId(null)
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, selectedForBridge: false } })))
      return
    }

    const P = nodes.find(n => n.id === pendingSourceId)
    if (!P) { setPendingSourceId(null); return }
    const C = node

    const pIsBridge = P.data.nodeType === 'bridge'
    const cIsBridge = C.data.nodeType === 'bridge'
    const pIsSeed = P.data.nodeType === 'seed'
    const cIsSeed = C.data.nodeType === 'seed'

    const clearPending = () =>
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, selectedForBridge: false } })))

    const commit = (finalSource: string, finalTarget: string) => {
      setEdges(eds => [...eds, { id: `${finalSource}-${finalTarget}-${uid()}`, source: finalSource, target: finalTarget }])
      setSnappingEdges(prev => [...prev, { sourceId: finalSource, targetId: finalTarget, createdAt: Date.now() }])
      setPendingSourceId(null)
      clearPending()
    }

    // Bridge involved — it may span the two sides
    if (pIsBridge || cIsBridge) {
      // Non-bridge end is the source, bridge is the target (bridge sits downstream)
      if (pIsBridge && cIsBridge) {
        commit(pendingSourceId!, node.id)
      } else if (cIsBridge) {
        commit(pendingSourceId!, node.id)
      } else {
        commit(node.id, pendingSourceId!)
      }
      return
    }

    // Neither is a bridge — enforce same-side locking
    const sideP = nodeSide(P)
    const sideC = nodeSide(C)

    if (sideP && sideC && sideP !== sideC) {
      setPendingSourceId(null)
      clearPending()
      setGateMessage("only a bridge can link the two sides")
      setTimeout(() => setGateMessage(null), 2500)
      return
    }

    // Same side but both floating (neither rooted to its seed) — nudge to root first
    if (!pIsSeed && !cIsSeed && !isRooted(P.id) && !isRooted(C.id)) {
      setPendingSourceId(null)
      clearPending()
      setGateMessage("connect this to its seed first")
      setTimeout(() => setGateMessage(null), 2500)
      return
    }

    // Direction: always flows shallow (seed-side) → deep
    const pDepth = getDepth(P.id, nodes, edges)
    const cDepth = getDepth(C.id, nodes, edges)
    const shouldFlip =
      (cIsSeed && !pIsSeed) ||
      (!isRooted(P.id) && isRooted(C.id)) ||
      (isRooted(P.id) && isRooted(C.id) && pDepth > cDepth)

    const finalSource = shouldFlip ? node.id : pendingSourceId!
    const finalTarget = shouldFlip ? pendingSourceId! : node.id
    commit(finalSource, finalTarget)
  }, [pendingSourceId, setNodes, setEdges, nodes, edges, nodeSide, isRooted])


  // Double-click existing node → re-enter edit mode (seeds are locked)
  const onNodeDoubleClick = useCallback((_e: React.MouseEvent, node: InterlinkedNode) => {
    if (node.data.nodeType === 'seed') return
    if (node.data.justCreated) return      // already in edit mode
    if (completionPhase === 'pulsing') return
    setNodes(nds => nds.map(n => n.id === node.id ? {
      ...n, draggable: false,
      data: { ...n.data, justCreated: true, originalText: n.data.text }
    } : n))
  }, [setNodes, completionPhase])

  // Click empty canvas → cancel pending connection
  const onPaneClick = useCallback(() => {
    if (pendingSourceId === null) return
    setPendingSourceId(null)
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, selectedForBridge: false } })))
  }, [pendingSourceId, setNodes])

  // Right-click node → delete star/bridge and its edges (seeds are protected)
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: InterlinkedNode) => {
    e.preventDefault()
    if (node.data.nodeType === 'seed') return
    setEdges(eds => eds.filter(ex => ex.source !== node.id && ex.target !== node.id))
    setNodes(nds => nds.filter(n => n.id !== node.id))
  }, [setEdges, setNodes])

  // Right-click edge → delete that edge
  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: InterlinkedEdge) => {
    e.preventDefault()
    setEdges(eds => eds.filter(ex => ex.id !== edge.id))
  }, [setEdges])

  // Converts a node's flow-space position to screen-space pixels for the SVG overlay
  function toScreen(pos: { x: number; y: number }) {
    const { x, y, zoom } = getViewport()
    return { x: pos.x * zoom + x, y: pos.y * zoom + y }
  }

  const pendingSourceNode = nodes.find(n => n.id === pendingSourceId)
  const pendingColor = pendingSourceNode ? getNodeColor(pendingSourceNode.data) : '#e4eade'

  // Is there a bridge that hasn't yet reached both sides?
  const hasUnspannedBridge = (() => {
    const bridges = nodes.filter(n => n.data.nodeType === 'bridge' && !n.data.justCreated)
    if (bridges.length === 0) return false
    return bridges.some(b => {
      const sides = new Set<string>()
      for (const e of edges) {
        const o = e.source === b.id ? e.target : e.target === b.id ? e.source : null
        if (o) { const sid = getSeedId(o, nodes, edges); if (sid) sides.add(sid) }
      }
      return sides.size < 2
    })
  })()

  // Ambient canvas prompt — hides during the completion sequence. The camera
  // teaches the interaction, so copy tracks cameraStage first; once
  // zoomedOut, the richer bridge-phase cascade below takes over.
  const canvasPrompt: string | null = (() => {
    if (completionPhase !== 'idle') return null
    if (cameraStage === 'seed1') {
      return getSubtreeCount('seed1', nodes, edges) === 0
        ? "Double-click the sky to place your first idea for this seed."
        : "Good thinking. Keep going to activate your first seed."
    }
    if (cameraStage === 'seed2') {
      return getSubtreeCount('seed2', nodes, edges) === 0
        ? "Now bring an idea to this seed."
        : "Just one more idea to activate."
    }
    const seed1 = nodes.find(n => n.id === 'seed1')
    const seed2 = nodes.find(n => n.id === 'seed2')
    if (!seed1?.data.activated || !seed2?.data.activated) return null
    if (hasUnspannedBridge) return "Link the bridge to an idea on each side"
    if (isBridgeReady) return "You unlocked a bridge node — Double-click to place one when you're ready."
    const hasDepth2 = nodes.some(n =>
      n.data.nodeType === 'star' && getDepth(n.id, nodes, edges) >= 2
    )
    if (hasDepth2) return "What connects these two sides?"
    return "The bridge phase begins! Go deeper. Ask a question. Expand on a thought."
  })()

  const overlayText = gateMessage ?? canvasPrompt
  const overlayStyle = gateMessage
    ? { color: '#e4c89e', opacity: 0.7 }
    : { color: '#e4eade', opacity: 0.45 }


  return (
    <CompletionCtx.Provider value={{ litIds: litNodeIds, phase: completionPhase }}>
    <NudgeCtx.Provider value={{ nudge }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', position: 'relative' }}
        onDoubleClick={onDoubleClick}
        onMouseMove={onMouseMove}
      >
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick} onPaneClick={onPaneClick}
          onNodeDoubleClick={onNodeDoubleClick} onNodeDragStop={onNodeDragStop}
          onNodeContextMenu={onNodeContextMenu} onEdgeContextMenu={onEdgeContextMenu}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          zoomOnDoubleClick={false}
          panOnDrag={!isEditingNode && cameraStage === 'zoomedOut'}
          zoomOnScroll={cameraStage === 'zoomedOut'}
          zoomOnPinch={cameraStage === 'zoomedOut'}
          panOnScroll={cameraStage === 'zoomedOut'}
          nodeOrigin={[0.5, 0.5]}
          nodesConnectable={false}
          elementsSelectable={false}
          defaultEdgeOptions={{
            type: 'interlinked',
            style: {
              stroke: '#4f5d4e',
              strokeWidth: 1.5,
              filter: 'drop-shadow(0 0 3px rgba(79, 93, 78, 0.6))',
            },
          }}
        />

        {/* Ambient canvas prompt — hides during completion */}
        {overlayText && completionPhase === 'idle' && (
          <div style={{
            position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
            fontSize: '13px',
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            whiteSpace: 'nowrap', pointerEvents: 'none',
            letterSpacing: '0.04em',
            transition: 'color 0.4s ease, opacity 0.4s ease',
            ...overlayStyle,
          }}>
            {overlayText}
          </div>
        )}

        {/* SVG overlay — rubber-band line + snap flash + completion wave */}
        <svg
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}
          width="100%" height="100%"
        >
          <defs>
            <style>{`
              .snap-flash-line {
                animation: snap-flash 1.2s ease-out forwards;
              }
              @keyframes snap-flash {
                from { opacity: 0.9; stroke-width: 2.75px; }
                to   { opacity: 0;   stroke-width: 0.75px; }
              }
              .completion-flash-line {
                animation: completion-flash 0.85s ease-out forwards;
              }
              @keyframes completion-flash {
                0%   { opacity: 1;   stroke-width: 3.5px; }
                40%  { opacity: 0.8; stroke-width: 2px; }
                100% { opacity: 0;   stroke-width: 0.5px; }
              }
              @keyframes completion-fade-in {
                from { opacity: 0; }
                to   { opacity: 1; }
              }
              @keyframes arrow-pulse {
                0%, 100% { opacity: 0.45; transform: translateX(0); }
                50%      { opacity: 1;    transform: translateX(5px); }
              }
              @keyframes arrow-text-in {
                from { opacity: 0; transform: translateX(-8px); }
                to   { opacity: 1; transform: translateX(0); }
              }
              @keyframes card-materialize {
                from { opacity: 0; transform: translate(-50%, -50%) scale(0.88); }
                to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
              }
              @keyframes dim-in {
                from { opacity: 0; }
                to   { opacity: 1; }
              }
            `}</style>
          </defs>

          {/* Rubber band — follows cursor while a connection is pending */}
          {pendingSourceNode && (
            <line
              x1={pendingAnchorPos.x} y1={pendingAnchorPos.y}
              x2={mousePos.x} y2={mousePos.y}
              stroke={pendingColor} strokeWidth={1.5}
              style={{ filter: `drop-shadow(0 0 6px ${pendingColor})` }}
            />
          )}

          {/* Snap flash — plays once on every new connection */}
          {snappingEdges.map(se => {
            const src = nodes.find(n => n.id === se.sourceId)
            const tgt = nodes.find(n => n.id === se.targetId)
            if (!src || !tgt) return null
            const { x: x1, y: y1 } = toScreen(src.position)
            const { x: x2, y: y2 } = toScreen(tgt.position)
            return (
              <line
                key={`snap-${se.createdAt}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="rgba(228, 234, 222, 0.9)" strokeWidth={2.75}
                className="snap-flash-line"
                onAnimationEnd={() =>
                  setSnappingEdges(prev => prev.filter(e => e.createdAt !== se.createdAt))
                }
              />
            )
          })}

          {/* Completion wave — lavender strobe traveling across each lit edge */}
          {completionFlashEdges.map(se => {
            const src = nodes.find(n => n.id === se.sourceId)
            const tgt = nodes.find(n => n.id === se.targetId)
            if (!src || !tgt) return null
            const { x: x1, y: y1 } = toScreen(src.position)
            const { x: x2, y: y2 } = toScreen(tgt.position)
            return (
              <line
                key={`completion-${se.createdAt}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="rgba(212, 208, 232, 0.95)" strokeWidth={3.5}
                className="completion-flash-line"
                onAnimationEnd={() =>
                  setCompletionFlashEdges(prev => prev.filter(e => e.createdAt !== se.createdAt))
                }
              />
            )
          })}
        </svg>

        {/* Arrow prompt — top-left corner, appears once after pulse settles */}
        {/* 'dismissed' stays interactive — user can always come back to it */}
        {arrowState !== 'hidden' && (
          <div
            style={{
              position: 'absolute', top: 24, left: 24, zIndex: 20,
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer',
              opacity: arrowState === 'dismissed'
                ? (isArrowHovered ? 0.75 : 0.2)
                : 1,
              transition: 'opacity 0.5s ease',
              userSelect: 'none',
            }}
            onMouseEnter={() => {
              setIsArrowHovered(true)
              setArrowTextVisible(true)
              if (arrowState === 'pulsing') setArrowState('seen')
            }}
            onMouseLeave={() => {
              setIsArrowHovered(false)
              setArrowTextVisible(false)
              if (arrowState === 'seen') setArrowState('dismissed')
            }}
            onClick={() => {
              setCardOpen(true)
              setCardFace('front')
              setArrowState('dismissed')
              setArrowTextVisible(false)
              setIsArrowHovered(false)
            }}
          >
            <span style={{
              fontSize: 26,
              fontWeight: 700,
              color: BRIDGE_COLOR,
              lineHeight: 1,
              display: 'inline-block',
              animation: arrowState === 'pulsing' ? 'arrow-pulse 1.6s ease-in-out infinite' : 'none',
              textShadow: `0 0 10px ${BRIDGE_COLOR}, 0 0 22px rgba(212, 208, 232, 0.5)`,
            }}>
              →
            </span>
            {(arrowTextVisible || arrowState === 'pulsing') && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 3,
                animation: 'arrow-text-in 0.25s ease forwards',
                marginLeft: arrowState === 'pulsing' ? 8 : 0,
                transition: 'margin-left 0.3s ease',
              }}>
                <p style={{
                  margin: 0, fontSize: 11, letterSpacing: '0.16em',
                  color: '#e4c89e', fontFamily: "'Plus Jakarta Sans', sans-serif",
                  opacity: 0.9,
                }}>
                  CONGRATULATIONS FOR COMPLETING THE BRIDGE
                </p>
                <p style={{
                  margin: 0, fontSize: 11, letterSpacing: '0.07em',
                  color: BRIDGE_COLOR, fontFamily: "'Plus Jakarta Sans', sans-serif",
                  opacity: 0.6,
                }}>
                  explore a note from the creator
                </p>
              </div>
            )}
          </div>
        )}

        {/* Replay button — sits on canvas after card is closed */}
        {showReplay && !cardOpen && (
          <button
            onClick={handleReplay}
            style={{
              position: 'absolute', bottom: 24, left: 24, zIndex: 20,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{
              fontSize: 11, color: BRIDGE_COLOR, opacity: 0.4,
              fontFamily: "'Plus Jakarta Sans', sans-serif", letterSpacing: '0.1em',
            }}>
              ↺  replay
            </span>
          </button>
        )}

        {/* Dim overlay — only while the card is open */}
        {cardOpen && (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 25,
              background: 'rgba(5, 5, 15, 0.78)',
              animation: 'dim-in 0.4s ease forwards',
            }}
            onClick={() => { setCardOpen(false); setShowReplay(true) }}
          />
        )}

        {/* Creator card — materializes from center when arrow is clicked */}
        {cardOpen && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            zIndex: 30,
            perspective: '1200px',
            animation: 'card-materialize 0.55s cubic-bezier(0.34, 1.3, 0.64, 1) forwards',
          }}>
            {/* Return to canvas — fixed to top-right of screen */}
            <button
              style={{
                position: 'fixed', top: 22, right: 24, zIndex: 35,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#e4eade', opacity: 0.4,
                fontSize: 11, letterSpacing: '0.12em',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                transition: 'opacity 0.2s ease',
              }}
              onClick={() => { setCardOpen(false); setShowReplay(true) }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
            >
              ← return to canvas
            </button>

            {/* Card inner — 3D flip between front (dark) and back (light) */}
            <div
              style={{
                width: 'min(680px, 88vw)',
                height: 'min(400px, 65vh)',
                position: 'relative',
                transformStyle: 'preserve-3d',
                transform: `rotateY(${cardFace === 'back' ? 180 : 0}deg)`,
                transition: 'transform 0.65s cubic-bezier(0.4, 0, 0.2, 1)',
                cursor: cardFace === 'front' ? 'pointer' : 'default',
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (cardFace === 'front') setCardFace('back')
              }}
            >
              {/* ── Front face ── dark, single word */}
              <div style={{
                position: 'absolute', inset: 0,
                backfaceVisibility: 'hidden',
                borderRadius: 10,
                background: 'linear-gradient(145deg, rgba(66, 75, 66, 0.92) 0%, #0d0d1a 100%)',
                border: '1px solid rgba(212, 208, 232, 0.12)',
                boxShadow: '0 0 80px rgba(212, 208, 232, 0.06), 0 32px 80px rgba(0,0,0,0.65)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 18,
              }}>
                <p style={{
                  margin: 0, fontSize: 30, letterSpacing: '0.127em',
                  color: '#e4eade', fontFamily: "'Cormorant Garamond', sans-serif",
                  fontWeight: 300,
                }}>
                  INTERLINKED
                </p>
                <p style={{
                  margin: 0, fontSize: 10, letterSpacing: '0.18em',
                  color: BRIDGE_COLOR, opacity: 0.4,
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}>
                  tap to open
                </p>
              </div>

              {/* ── Back face ── light, creator note, scrollable */}
              <div style={{
                position: 'absolute', inset: 0,
                backfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
                borderRadius: 10,
                background: '#f6f3ee',
                border: '1px solid rgba(200, 195, 180, 0.5)',
                boxShadow: '0 0 80px rgba(212, 208, 232, 0.06), 0 32px 80px rgba(0,0,0,0.65)',
                overflow: 'hidden',
              }}>
                {/* Scrollable content — stopPropagation so clicks here don't flip the card */}
                <div
                  style={{
                    height: '100%', overflowY: 'auto',
                    padding: '32px 44px 28px',
                    boxSizing: 'border-box',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(0,0,0,0.1) transparent',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <p style={{
                    margin: '0 0 20px', fontSize: 10, letterSpacing: '0.2em',
                    color: '#a09880', fontFamily: "'Plus Jakarta Sans', sans-serif",
                    textTransform: 'uppercase',
                  }}>
                    A note from the creator
                  </p>
                  <p style={{
                    margin: '0 0 22px', fontSize: 13, lineHeight: 1.75,
                    color: '#2a2820', fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontStyle: 'italic', opacity: 0.55,
                  }}>
                    “Prethought is black and white, thoughts and words create color.”
                  </p>
                  <p style={{
                    margin: '0 0 16px', fontSize: 13, lineHeight: 1.82,
                    color: '#2a2820', fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}>
                    First of all, I really want to thank you for completing the first ever handwritten Interlinked prompt. It really means a lot, and I hope you genuinely put effort into the prompt today. I workshopped this first prompt with a journal entry about how sometimes writing can feel like jumping into a void with hopes of understanding.
                  </p>
                  <p style={{
                    margin: '0 0 16px', fontSize: 13, lineHeight: 1.82,
                    color: '#2a2820', fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}>
                    That entrance toward understanding isn’t always pretty. It’s raw. It’s vulnerable, but our thoughts were never meant to be contained in our brains. Our brains are made to produce thought, and words allow us to package our black and white ideas into colorful coherent thoughts. 
                  </p>
                  <p style={{
                    margin: '0 0 28px', fontSize: 13, lineHeight: 1.82,
                    color: '#2a2820', fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}>
                    I hope you were able to see some of that color in your constellation today! Even if you were nervous to type, this is what Interlinked is about. I’ll let you get back to working on your canvas if you have more to paint. See you for the next one. 
                  </p>
                  <p style={{
                    margin: '0 0 24px', fontSize: 12, letterSpacing: '0.05em',
                    color: '#a09880', fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}>
                    — Katie
                  </p>
                  {/* Flip-back affordance */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        fontSize: 11, letterSpacing: '0.1em', color: '#a09880',
                        fontFamily: "'Plus Jakarta Sans', sans-serif", padding: 0,
                        opacity: 0.7,
                      }}
                      onClick={(e) => { e.stopPropagation(); setCardFace('front') }}
                    >
                      ↩  flip
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </NudgeCtx.Provider>
    </CompletionCtx.Provider>
  )
}


// ─── Root export ──────────────────────────────────────────────────────────────

export function ConstellationCanvas({ seed1Label, seed2Label, onSnapshot, savedNodes, savedEdges }: {
  seed1Label: string
  seed2Label: string
  onSnapshot?: (nodes: unknown, edges: unknown) => void
  savedNodes?: InterlinkedNode[] | null
  savedEdges?: InterlinkedEdge[] | null
}) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlowProvider>
        <CanvasInner seed1Label={seed1Label} seed2Label={seed2Label} onSnapshot={onSnapshot} savedNodes={savedNodes} savedEdges={savedEdges}/>
      </ReactFlowProvider>
    </div>
  )
}
