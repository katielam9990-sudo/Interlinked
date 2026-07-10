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
  [key: string]: unknown
  size?: number
}

type InterlinkedNode = Node<InterlinkedNodeData>
type InterlinkedEdge = Edge<{ dissolving?: boolean }>
type SnappingEdge = { sourceId: string; targetId: string; createdAt: number }
type CompletionPhase = 'idle' | 'pulsing' | 'done'
type NodeKind = 'seed1' | 'seed2' | 'bridge'


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


// ─── Initial data ─────────────────────────────────────────────────────────────

const initialNodes: InterlinkedNode[] = [
  {
    id: 'seed1', type: 'seed', position: { x: 200, y: 300 },
    data: {
      text: "A belief you've released...", nodeType: 'seed', seedId: 'seed1', lockedSeed: 'seed1',
      depth: 0, glowState: 'none', charCount: 0, isValid: false,
      subtreeCount: 0, activated: false, visible: true,
      selectedForBridge: false, justCreated: false,
    }
  },
  {
    id: 'seed2', type: 'seed', position: { x: 600, y: 300 },
    data: {
      text: "What replaced it...", nodeType: 'seed', seedId: 'seed2', lockedSeed: 'seed2',
      depth: 0, glowState: 'none', charCount: 0, isValid: false,
      subtreeCount: 0, activated: false, visible: false,
      selectedForBridge: false, justCreated: false,
    }
  }
]

const initialEdges: InterlinkedEdge[] = []


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

function StarNode({ data, id }: NodeProps<InterlinkedNode>) {
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

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && data.isValid) {
      setNodes(nds => nds.map(n => n.id === id ? {
        ...n,
        draggable: true,
        data: { ...n.data, justCreated: false, size: getStarSize(n.data.charCount as number) }
      } : n))
    } else if (e.key === 'Escape') {
      setNodes(nds => nds.filter(n => n.id !== id))
    }
  }, [id, data.isValid, setNodes])

  const onBlur = useCallback(() => {
    if (!data.isValid) setNodes(nds => nds.filter(n => n.id !== id))
  }, [id, data.isValid, setNodes])

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

      {(hovered || data.selectedForBridge) && (
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


// ─── BridgeNode ───────────────────────────────────────────────────────────────
// The connector node. Takes user input like a star, but is lavender and may
// link across both sides. Only created once bridge criteria are met.

function BridgeNode({ id, data }: NodeProps<InterlinkedNode>) {
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

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, data: { ...n.data, text, charCount: text.length, isValid: text.length >= 10 } } : n
    ))
  }, [id, setNodes])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && data.isValid) {
      setNodes(nds => nds.map(n => n.id === id ? {
        ...n,
        draggable: true,
        data: { ...n.data, justCreated: false, size: 13 }
      } : n))
    } else if (e.key === 'Escape') {
      setNodes(nds => nds.filter(n => n.id !== id))
    }
  }, [id, data.isValid, setNodes])

  const onBlur = useCallback(() => {
    if (!data.isValid) setNodes(nds => nds.filter(n => n.id !== id))
  }, [id, data.isValid, setNodes])

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

      {hovered && (
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
const nodeTypes: NodeTypes = { seed: SeedNode, star: StarNode, bridge: BridgeNode }


// ─── Canvas inner ─────────────────────────────────────────────────────────────

function CanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<InterlinkedNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<InterlinkedEdge>(initialEdges)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pendingAnchorPos, setPendingAnchorPos] = useState({ x: 0, y: 0 })
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [snappingEdges, setSnappingEdges] = useState<SnappingEdge[]>([])
  const [gateMessage, setGateMessage] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ screen: { x: number; y: number }; flow: { x: number; y: number } } | null>(null)
  const [completionPhase, setCompletionPhase] = useState<CompletionPhase>('idle')
  const [litNodeIds, setLitNodeIds] = useState<Set<string>>(new Set())
  const [completionFlashEdges, setCompletionFlashEdges] = useState<SnappingEdge[]>([])
  const completionTriggered = useRef(false)
  const { screenToFlowPosition, getViewport, fitView } = useReactFlow()
  const isEditingNode = nodes.some(n => n.data.justCreated)


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


  // ── Completion pulse ────────────────────────────────────────────────────────
  // BFS wave from the bridge node outward. The zoom-out runs FIRST and settles;
  // only then does the wave travel, so the SVG strobe lines don't jump around
  // while the viewport is still animating.
  const triggerCompletionPulse = useCallback((
    originId: string,
    allNodes: InterlinkedNode[],
    allEdges: InterlinkedEdge[]
  ) => {
    completionTriggered.current = true
    setCompletionPhase('pulsing')

    const ZOOM_DURATION = 900
    const PULSE_START_DELAY = ZOOM_DURATION + 150   // let the zoom fully settle first

    // Zoom out to reveal the whole constellation
    fitView({ duration: ZOOM_DURATION, padding: 0.35 })

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
      () => setCompletionPhase('done'),
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
        triggerCompletionPulse(bridgeNode.id, nodes, edges)
        return
      }
    }
  }, [nodes, edges, completionPhase, triggerCompletionPulse])


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


  // Create a node of the chosen kind at a flow position
  const createNode = useCallback((kind: NodeKind, flow: { x: number; y: number }) => {
    if (kind === 'bridge') {
      setNodes(nds => [...nds, {
        id: uid(), type: 'bridge', position: flow, draggable: false,
        data: {
          text: '', nodeType: 'bridge', seedId: null, lockedSeed: null, depth: 0,
          glowState: 'bright', charCount: 0, isValid: false, subtreeCount: 0,
          activated: false, visible: true, selectedForBridge: false, justCreated: true, size: 8,
        }
      }])
    } else {
      setNodes(nds => [...nds, {
        id: uid(), type: 'star', position: flow, draggable: false,
        data: {
          text: '', nodeType: 'star', seedId: null, lockedSeed: kind, depth: 1,
          glowState: 'none', charCount: 0, isValid: false, subtreeCount: 0,
          activated: false, visible: true, selectedForBridge: false, justCreated: true, size: 8,
        }
      }])
    }
  }, [setNodes])


  // Double-click empty canvas:
  //   — before seed2 exists → create a seed1 idea directly (only one option)
  //   — otherwise → open the type menu (orange / green / + lavender when unlocked)
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (completionPhase !== 'idle') return
    if (!(e.target as Element).classList.contains('react-flow__pane')) return
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const rect = containerRef.current?.getBoundingClientRect()
    const screen = rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: e.clientX, y: e.clientY }

    if (!seed2Visible) {
      createNode('seed1', flow)
      return
    }
    setMenu({ screen, flow })
  }, [completionPhase, screenToFlowPosition, seed2Visible, createNode])


  // Click node → two-click linking with side-locking enforcement
  const onNodeClick = useCallback((e: React.MouseEvent, node: InterlinkedNode) => {
    if (node.data.justCreated) return
    setMenu(null)

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


  // Click empty canvas → cancel pending connection and close the menu
  const onPaneClick = useCallback(() => {
    setMenu(null)
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

  // Ambient canvas prompt — hides during the completion sequence
  const canvasPrompt: string | null = (() => {
    if (completionPhase !== 'idle') return null
    const seed1 = nodes.find(n => n.id === 'seed1')
    const seed2 = nodes.find(n => n.id === 'seed2')
    if (!seed1?.data.activated || !seed2?.data.activated) return null
    if (hasUnspannedBridge) return "link the bridge to an idea on each side"
    if (isBridgeReady) return "a bridge is ready — double-click to place one"
    const hasDepth2 = nodes.some(n =>
      n.data.nodeType === 'star' && getDepth(n.id, nodes, edges) >= 2
    )
    if (hasDepth2) return "what connects these two sides?"
    return "go deeper into your thoughts"
  })()

  const overlayText = gateMessage ?? canvasPrompt
  const overlayStyle = gateMessage
    ? { color: '#e4c89e', opacity: 0.7 }
    : { color: '#e4eade', opacity: 0.45 }

  // Menu options — seed1 always, seed2 once visible, bridge once unlocked
  const menuOptions: { kind: NodeKind; label: string; color: string }[] = [
    { kind: 'seed1', label: 'Idea · this side', color: SEED1_COLOR },
    { kind: 'seed2', label: 'Idea · other side', color: SEED2_COLOR },
    ...(isBridgeReady ? [{ kind: 'bridge' as NodeKind, label: 'Bridge · connect both', color: BRIDGE_COLOR }] : []),
  ]


  return (
    <CompletionCtx.Provider value={{ litIds: litNodeIds, phase: completionPhase }}>
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
          onNodeContextMenu={onNodeContextMenu} onEdgeContextMenu={onEdgeContextMenu}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          zoomOnDoubleClick={false}
          panOnDrag={!isEditingNode}
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

        {/* Type menu — appears on double-click once both sides are in play */}
        {menu && completionPhase === 'idle' && (
          <div
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: menu.screen.x,
              top: menu.screen.y,
              transform: 'translate(-4px, -4px)',
              zIndex: 30,
              display: 'flex', flexDirection: 'column', gap: 2,
              padding: 6,
              background: 'rgba(18, 20, 28, 0.92)',
              border: '1px solid rgba(228, 234, 222, 0.12)',
              borderRadius: 10,
              backdropFilter: 'blur(8px)',
              boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            {menuOptions.map(opt => (
              <button
                key={opt.kind}
                onClick={() => { createNode(opt.kind, menu.flow); setMenu(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '7px 12px 7px 9px',
                  background: 'transparent', border: 'none', borderRadius: 7,
                  cursor: 'pointer', color: '#e4eade',
                  fontSize: 12.5, whiteSpace: 'nowrap', textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(228,234,222,0.06)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: opt.color,
                  boxShadow: `0 0 8px ${opt.color}`,
                }} />
                {opt.label}
              </button>
            ))}
          </div>
        )}

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

        {/* Completion overlay — fades in after all nodes are lit */}
        {completionPhase === 'done' && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(ellipse at center, rgba(10,10,20,0.65) 0%, rgba(5,5,15,0.85) 100%)',
            animation: 'completion-fade-in 1.8s ease forwards',
            pointerEvents: 'none',
          }}>
            <p style={{
              color: '#e4c89e', fontSize: '11px', letterSpacing: '0.22em',
              opacity: 0.75, fontFamily: "'Plus Jakarta Sans', sans-serif",
              margin: 0, marginBottom: 14,
            }}>
              YOUR IDEAS WERE ALWAYS INTERLINKED
            </p>
            <p style={{
              color: BRIDGE_COLOR, fontSize: '13px', letterSpacing: '0.1em',
              opacity: 0.45, fontFamily: "'Plus Jakarta Sans', sans-serif", margin: 0,
            }}>
              witness them
            </p>
          </div>
        )}
      </div>
    </CompletionCtx.Provider>
  )
}


// ─── Root export ──────────────────────────────────────────────────────────────

export function ConstellationCanvas() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
    </div>
  )
}

