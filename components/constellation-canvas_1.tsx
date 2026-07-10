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

type InterlinkedNodeData = {
  text: string
  nodeType: 'seed' | 'star' | 'bridge'
  seedId: 'seed1' | 'seed2' | null
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


// ─── Completion context ───────────────────────────────────────────────────────
// Propagates lit node IDs + completion phase into node components without
// prop drilling through React Flow's renderer.

const CompletionCtx = createContext<{ litIds: Set<string>; phase: CompletionPhase }>({
  litIds: new Set(),
  phase: 'idle',
})


// ─── Initial data ─────────────────────────────────────────────────────────────

const initialNodes: InterlinkedNode[] = [
  {
    id: 'seed1', type: 'seed', position: { x: 200, y: 300 },
    data: {
      text: "A belief you've released...", nodeType: 'seed', seedId: 'seed1',
      depth: 0, glowState: 'none', charCount: 0, isValid: false,
      subtreeCount: 0, activated: false, visible: true,
      selectedForBridge: false, justCreated: false,
    }
  },
  {
    id: 'seed2', type: 'seed', position: { x: 600, y: 300 },
    data: {
      text: "What replaced it...", nodeType: 'seed', seedId: 'seed2',
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

// Single source of truth for node color — used by node components + SVG overlay
function getNodeColor(data: InterlinkedNodeData): string {
  if (data.nodeType === 'bridge') return '#d4d0e8'
  if (data.nodeType === 'seed') {
    return data.seedId === 'seed1' ? '#f5c842' : '#8faa8b'
  }
  if (data.seedId === 'seed1') {
    if (data.depth <= 1) return '#fde4b7'
    if (data.depth === 2) return '#f8e8c6'
    return '#ede9e0'
  }
  if (data.seedId === 'seed2') {
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

function getSeedId(id: string, nodes: InterlinkedNode[], edges: InterlinkedEdge[]): 'seed1' | 'seed2' | null {
  let currentId = id
  while (true) {
    const node = nodes.find(n => n.id === currentId)
    if (!node) return null
    if (node.data.nodeType === 'seed') return node.id as 'seed1' | 'seed2'
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

  // Pulse dot outward when the completion wave reaches this node
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
          placeholder="Type an idea..."
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

  // Wrapper is immediately the final size so React Flow's bounding box is correct.
  // The visual dot starts at 8px and animates up via displaySize.
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
// The final node — connects to both seed trees to complete the constellation.

function BridgeNode({ id, data }: NodeProps<InterlinkedNode>) {
  const [hovered, setHovered] = useState(false)
  const [displaySize, setDisplaySize] = useState(8)
  const [pulseScale, setPulseScale] = useState(1)
  const { litIds } = useContext(CompletionCtx)
  const isLit = litIds.has(id)

  // Bridge pulses slightly more dramatically — it's the origin of the wave
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

  const finalSize = data.size ?? 13
  const color = '#d4d0e8'
  const glowAmount = hovered ? 28 : 14
  const effectiveGlow = isLit ? glowAmount + 22 : glowAmount

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Outer ring — visually distinguishes the bridge node */}
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
          color, opacity: 0.75, fontSize: '12px',
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          {data.text || 'What connects them?'}
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
  const [completionPhase, setCompletionPhase] = useState<CompletionPhase>('idle')
  const [litNodeIds, setLitNodeIds] = useState<Set<string>>(new Set())
  const [completionFlashEdges, setCompletionFlashEdges] = useState<SnappingEdge[]>([])
  const completionTriggered = useRef(false)
  const { screenToFlowPosition, getViewport, fitView } = useReactFlow()
  const isEditingNode = nodes.some(n => n.data.justCreated)


  // Recompute all derived node data whenever edges change.
  // Also reveals seed2 once seed1 reaches activated state (subtreeCount >= 2).
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
  // BFS wave from the bridge node outward. Each layer lights up 350ms after the
  // previous, and completion flash edges strobe along each newly-lit connection.
  const triggerCompletionPulse = useCallback((
    originId: string,
    allNodes: InterlinkedNode[],
    allEdges: InterlinkedEdge[]
  ) => {
    completionTriggered.current = true
    setCompletionPhase('pulsing')

    // Zoom out to reveal the whole constellation as the wave travels
    fitView({ duration: 1200, padding: 0.35 })

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
        // Light up this layer's nodes
        setLitNodeIds(prev => {
          const next = new Set(prev)
          layer.forEach(id => next.add(id))
          return next
        })

        // Strobe the edges that connect this layer to the previous one
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
      }, layerIndex * LAYER_DELAY)
    })

    // Transition to 'done' after all layers have lit + a brief hold
    setTimeout(() => setCompletionPhase('done'), layers.length * LAYER_DELAY + 900)
  }, [fitView])


  // Watch for the moment the bridge node connects to both seed chains
  useEffect(() => {
    if (completionPhase !== 'idle' || completionTriggered.current) return
    const bridgeNode = nodes.find(n => n.data.nodeType === 'bridge')
    if (!bridgeNode) return

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
    }
  }, [nodes, edges, completionPhase, triggerCompletionPulse])


  // Track cursor position — drives the rubber-band line while pending
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [pendingSourceId])


  // Computed: both seed trees have depth ≥ 2 and there's no bridge yet
  const isBridgeReady = (() => {
    const seed1 = nodes.find(n => n.id === 'seed1')
    const seed2 = nodes.find(n => n.id === 'seed2')
    if (!seed1?.data.activated || !seed2?.data.activated) return false
    if (nodes.some(n => n.data.nodeType === 'bridge')) return false  // one bridge at a time
    const seed1HasDepth2 = nodes.some(n =>
      n.data.nodeType === 'star' &&
      getSeedId(n.id, nodes, edges) === 'seed1' &&
      getDepth(n.id, nodes, edges) >= 2
    )
    const seed2HasDepth2 = nodes.some(n =>
      n.data.nodeType === 'star' &&
      getSeedId(n.id, nodes, edges) === 'seed2' &&
      getDepth(n.id, nodes, edges) >= 2
    )
    return seed1HasDepth2 && seed2HasDepth2
  })()


  // Double-click empty canvas:
  //   — if bridge-ready → place the bridge node (no text entry needed)
  //   — otherwise → create a new star with text input
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!(e.target as Element).classList.contains('react-flow__pane')) return
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })

    if (isBridgeReady) {
      setNodes(nds => [...nds, {
        id: uid(), type: 'bridge', position, draggable: true,
        data: {
          text: '', nodeType: 'bridge', seedId: null, depth: 0, glowState: 'bright',
          charCount: 0, isValid: true, subtreeCount: 0, activated: false,
          visible: true, selectedForBridge: false, justCreated: false, size: 13,
        }
      }])
    } else {
      setNodes(nds => [...nds, {
        id: uid(), type: 'star', position, draggable: false,
        data: {
          text: '', nodeType: 'star', seedId: null, depth: 1, glowState: 'none',
          charCount: 0, isValid: false, subtreeCount: 0, activated: false,
          visible: true, selectedForBridge: false, justCreated: true, size: 8,
        }
      }])
    }
  }, [screenToFlowPosition, setNodes, isBridgeReady])


  // Click node → two-click linking: first click selects source, second completes edge
  const onNodeClick = useCallback((e: React.MouseEvent, node: InterlinkedNode) => {
    if (node.data.justCreated) return
    if (pendingSourceId === null) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) setPendingAnchorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      setPendingSourceId(node.id)
      setNodes(nds => nds.map(n =>
        n.id === node.id ? { ...n, data: { ...n.data, selectedForBridge: true } } : n
      ))
    } else if (pendingSourceId === node.id) {
      // Clicked same node again — cancel
      setPendingSourceId(null)
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, selectedForBridge: false } })))
    } else {
      const pendingNode = nodes.find(n => n.id === pendingSourceId)
      const pendingDepth = getDepth(pendingSourceId!, nodes, edges)
      const clickedDepth = getDepth(node.id, nodes, edges)
      const pendingHasSeed = getSeedId(pendingSourceId!, nodes, edges) !== null
      const clickedHasSeed = getSeedId(node.id, nodes, edges) !== null
      const pendingIsBridge = pendingNode?.data.nodeType === 'bridge'
      const clickedIsBridge = node.data.nodeType === 'bridge'

      // Gate: two unrooted, non-bridge stars can't connect to each other
      if (!pendingHasSeed && !clickedHasSeed && !pendingIsBridge && !clickedIsBridge) {
        setPendingSourceId(null)
        setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, selectedForBridge: false } })))
        setGateMessage("connect your idea to a seed first")
        setTimeout(() => setGateMessage(null), 2500)
        return
      }

      // Edge direction: always flows from shallower (seed-side) to deeper
      const shouldFlip =
        (node.data.nodeType === 'seed' && pendingNode?.data.nodeType !== 'seed') ||
        (!pendingHasSeed && clickedHasSeed && !pendingIsBridge) ||
        (pendingHasSeed && clickedHasSeed && pendingDepth > clickedDepth)

      const finalSource = shouldFlip ? node.id : pendingSourceId!
      const finalTarget = shouldFlip ? pendingSourceId! : node.id

      setEdges(eds => [...eds, {
        id: `${finalSource}-${finalTarget}`,
        source: finalSource,
        target: finalTarget,
      }])
      setSnappingEdges(prev => [...prev, { sourceId: finalSource, targetId: finalTarget, createdAt: Date.now() }])
      setPendingSourceId(null)
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, selectedForBridge: false } })))
    }
  }, [pendingSourceId, setNodes, setEdges, nodes, edges])


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

  // Ambient canvas prompt — hides during the completion sequence
  const canvasPrompt: string | null = (() => {
    if (completionPhase !== 'idle') return null
    const seed1 = nodes.find(n => n.id === 'seed1')
    const seed2 = nodes.find(n => n.id === 'seed2')
    if (!seed1?.data.activated || !seed2?.data.activated) return null
    if (isBridgeReady) return "double-click to place the bridge"
    const hasDepth2 = nodes.some(n =>
      n.data.nodeType === 'star' &&
      getDepth(n.id, nodes, edges) >= 2
    )
    if (hasDepth2) return "what connects these two sides?"
    return "go deeper into your thoughts"
  })()

  const overlayText = gateMessage ?? canvasPrompt
  const overlayStyle = gateMessage
    ? { color: '#e4c89e', opacity: 0.7 }
    : { color: '#e4eade', opacity: 0.45 }


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
              color: '#e4c89e',
              fontSize: '11px',
              letterSpacing: '0.22em',
              opacity: 0.75,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              margin: 0,
              marginBottom: 14,
            }}>
              YOUR IDEAS WERE ALWAYS INTERLINKED
            </p>
            <p style={{
              color: '#d4d0e8',
              fontSize: '13px',
              letterSpacing: '0.1em',
              opacity: 0.45,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              margin: 0,
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
