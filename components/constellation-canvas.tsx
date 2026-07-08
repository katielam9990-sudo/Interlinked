"use client"

import { useCallback, useEffect, useState, useRef } from 'react'
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
  if (data.nodeType === 'seed') {
    return data.seedId === 'seed1' ? '#f5c842' : '#8faa8b'
  }
  if (data.seedId === 'seed1') {
    if (data.depth <= 1) return '#f5c842'
    if (data.depth === 2) return '#c9a84c'
    return '#e4eade'
  }
  if (data.seedId === 'seed2') {
    if (data.depth <= 1) return '#8faa8b'
    if (data.depth === 2) return '#a8c4ab'
    return '#e4eade'
  }
  return '#e4eade'
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
  if (charCount >= 75) return 14
  if (charCount >= 50) return 12
  if (charCount >= 40) return 10
  return 9
}

// ─── Shared styles ────────────────────────────────────────────────────────────

// Pins handles to the center of the star circle so edges connect to the dot,
// not the top/bottom edge of the React Flow node bounding box
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

function SeedNode({ data }: NodeProps<InterlinkedNode>) {
  if (!data.visible) return null

  const color = getNodeColor(data)
  const shadowBase = data.seedId === 'seed1' ? '245, 200, 66' : '143, 170, 139'
  const glowAmount = data.glowState === 'none' ? 5 : data.glowState === 'soft' ? 15 : 30
  const dotOpacity = data.glowState === 'none' ? 0.5 : data.glowState === 'soft' ? 0.75 : 1

  return (
    <div style={{ position: 'relative', width: 12, height: 12 }}>
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
        boxShadow: `0 0 ${glowAmount}px rgba(${shadowBase}, 0.9), 0 0 ${glowAmount * 2}px rgba(${shadowBase}, 0.4)`,
        transition: 'opacity 0.8s ease, box-shadow 0.8s ease',
      }} />
      <p style={{
        position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)',
        color, fontSize: '12px', whiteSpace: 'nowrap', pointerEvents: 'none',
      }}>
        {data.text}
      </p>
      <div style={{
        position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '4px',
      }}>
        {[0, 1].map((i) => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: i < data.subtreeCount ? color : 'transparent',
            border: `1px solid rgba(${shadowBase}, 0.5)`,
            transition: 'background-color 0.4s ease',
          }} />
        ))}
      </div>
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
        data: { ...n.data, justCreated: false, size: getStarSize(n.data.charCount) }
      } : n))
    } else if (e.key === 'Escape') {
      setNodes(nds => nds.filter(n => n.id !== id))
    }
  }, [id, data.isValid, setNodes])

  const onBlur = useCallback(() => {
    if (!data.isValid) setNodes(nds => nds.filter(n => n.id !== id))
  }, [id, data.isValid, setNodes])

  const color = getNodeColor(data)
  const glowAmount = data.glowState === 'none' ? 5 : data.glowState === 'soft' ? 15 : 30
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
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          backgroundColor: color, opacity,
          boxShadow: `0 0 ${glowAmount}px ${color}, 0 0 ${glowAmount * 2}px ${color}60`,
          transition: 'width 0.5s ease, height 0.5s ease, opacity 0.6s ease, box-shadow 0.6s ease',
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
const nodeTypes: NodeTypes = { seed: SeedNode, star: StarNode }


// ─── Canvas inner ─────────────────────────────────────────────────────────────

function CanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<InterlinkedNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<InterlinkedEdge>(initialEdges)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pendingAnchorPos, setPendingAnchorPos] = useState({ x: 0, y: 0 })
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [snappingEdges, setSnappingEdges] = useState<SnappingEdge[]>([])
  const { screenToFlowPosition, getViewport } = useReactFlow()
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

  // Track cursor — only fires re-renders while a connection is pending
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [pendingSourceId])

  // Double-click empty canvas → create new star at that position
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!(e.target as Element).classList.contains('react-flow__pane')) return
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setNodes(nds => [...nds, {
      id: uid(), type: 'star', position, draggable: false,
      data: {
        text: '', nodeType: 'star', seedId: null, depth: 1, glowState: 'none',
        charCount: 0, isValid: false, subtreeCount: 0, activated: false,
        visible: true, selectedForBridge: false, justCreated: true, size: 8,
      }
    }])
  }, [screenToFlowPosition, setNodes])

  // Click node → two-click linking: first click selects source, second click completes edge
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
      const shouldFlip = node.data.nodeType === 'seed' && pendingNode?.data.nodeType !== 'seed'
      const finalSource = shouldFlip ? node.id : pendingSourceId
      const finalTarget = shouldFlip ? pendingSourceId : node.id

      setEdges(eds => [...eds, { id: `${finalSource}-${finalTarget}`, source: finalSource, target: finalTarget }])
      setSnappingEdges(prev => [...prev, { sourceId: finalSource, targetId: finalTarget, createdAt: Date.now() }])
      setPendingSourceId(null)
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, selectedForBridge: false } })))
    }
  }, [pendingSourceId, setNodes, setEdges])

  // Click empty canvas → cancel pending connection
  const onPaneClick = useCallback(() => {
    if (pendingSourceId === null) return
    setPendingSourceId(null)
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, selectedForBridge: false } })))
  }, [pendingSourceId, setNodes])

  // Right-click node → delete star and its edges (seeds are protected)
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

  return (
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

      {/* SVG overlay — lives on top of React Flow, pointer-events disabled so it doesn't block interaction */}
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
          `}</style>
        </defs>

        {/* Rubber band line — follows cursor while a connection is pending */}
        {pendingSourceNode && (
          <line
            x1={pendingAnchorPos.x} y1={pendingAnchorPos.y}
            x2={mousePos.x} y2={mousePos.y}
            stroke={pendingColor} strokeWidth={1.5}
            style={{ filter: `drop-shadow(0 0 6px ${pendingColor})` }}
          />
        )}

        {/* Snap flash — bright fade-out line plays once on new connection, then removes itself */}
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
      </svg>
    </div>
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




























// "use client"

// import { useRef, useEffect } from "react"

// type Seed = {
//   text: string
//   x: number
//   y: number
// }

// export function ConstellationCanvas({ seeds }: { seeds: Seed[] }) {
//   const canvasRef = useRef<HTMLCanvasElement>(null)

//   useEffect(() => {
//     const canvas = canvasRef.current!
//     if (!canvas) return
//     const ctx = canvas.getContext('2d')!
//     if (!ctx) return

//     let mouse = { x: 0, y: 0 }
//     let camera = { x: 40, y: -30 }
//     let stars = spawn_seeds()
//     let links: { from: number; to: number | null }[] = []
//     let active_link: { from: number; to: number | null } | null = null
//     let is_dragging = false
//     let start_mouse = { x: 0, y: 0 }
//     let animationId: number
//     let drag_star_index = -1
//     let drag_threshold_crossed = false
//     let snapping_links: { from: number; to: number; created_at: number }[] = []
//     let active_input: HTMLInputElement | null = null

//     function spawn_seeds() {
//       const now = performance.now()
//       return seeds.map((seed) => ({
//         world_x: seed.x,
//         world_y: seed.y,
//         screen_x: 0,
//         screen_y: 0,
//         radius: 6,
//         text: seed.text,
//         glow: 15,
//         is_hovered: false,
//         is_seed: true,
//         birth_time: now
//       }))
//     }

//     function resizeCanvas() {
//       canvas.width = canvas.offsetWidth
//       canvas.height = canvas.offsetHeight
//     }

//     function camera_update(star: typeof stars[0]) {
//       star.screen_x = star.world_x - camera.x
//       star.screen_y = star.world_y - camera.y
//     }

//     function detect_hover(star: typeof stars[0]) {
//       const dx = mouse.x - star.screen_x
//       const dy = mouse.y - star.screen_y
//       const distance = Math.sqrt(dx * dx + dy * dy)
//       star.is_hovered = distance < star.radius + 10
//       star.glow = star.is_hovered ? 25 : 17
//     }

//     function point_to_line_distance(
//       px: number, py: number,
//       ax: number, ay: number,
//       bx: number, by: number
//     ) {
//       const dx = bx - ax
//       const dy = by - ay
//       const len_sq = dx * dx + dy * dy
//       if (len_sq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
//       let t = ((px - ax) * dx + (py - ay) * dy) / len_sq
//       t = Math.max(0, Math.min(1, t))
//       const closest_x = ax + t * dx
//       const closest_y = ay + t * dy
//       return Math.sqrt((px - closest_x) ** 2 + (py - closest_y) ** 2)
//     }

//     function draw_star(star: typeof stars[0]) {
//       const is_selected = active_link !== null && stars[active_link.from] === star
//       const age = performance.now() - star.birth_time
//       const entrance_opacity = Math.min(1, age / 700)

//       ctx.globalAlpha = entrance_opacity
//       ctx.fillStyle = star.is_seed ? "#f5c842" : "#e4eade"
//       ctx.shadowColor = star.is_seed ? "#f5c842" : "#e8e4db"
//       ctx.shadowBlur = is_selected ? 35 : star.glow

//       const display_radius = is_selected ? star.radius * 1.4 : star.radius

//       ctx.beginPath()
//       ctx.arc(star.screen_x, star.screen_y, display_radius, 0, Math.PI * 2)
//       ctx.fill()
//       ctx.shadowBlur = 0

//       if (is_selected) {
//         ctx.strokeStyle = star.is_seed
//           ? "rgba(245, 200, 66, 0.35)"
//           : "rgba(228, 234, 222, 0.35)"
//         ctx.lineWidth = 1
//         ctx.beginPath()
//         ctx.arc(star.screen_x, star.screen_y, display_radius + 9, 0, Math.PI * 2)
//         ctx.stroke()
//       }

//       if (star.is_hovered || is_selected) {
//         ctx.font = "14px 'Plus Jakarta Sans'"
//         ctx.fillStyle = star.is_seed ? "#f5c842" : "#e8e4db"
//         ctx.fillText(star.text, star.screen_x + display_radius + 10, star.screen_y + 5)
//       }

//       ctx.globalAlpha = 1
//     }

//     function draw_link(link: { from: number; to: number | null }) {
//       const start_dot = stars[link.from]
//       const end_dot = link.to !== null ? stars[link.to] : null
//       if (!start_dot) return

//       if (start_dot && end_dot) {
//         ctx.strokeStyle = "#4f5d4e"
//         ctx.lineWidth = 1.5
//         ctx.beginPath()
//         ctx.moveTo(start_dot.screen_x, start_dot.screen_y)
//         ctx.lineTo(end_dot.screen_x, end_dot.screen_y)
//         ctx.stroke()
//       } else {
//         const source = stars[link.from]
//         ctx.strokeStyle = source?.is_seed
//           ? "rgba(245, 200, 66, 0.9)"
//           : "rgba(228, 234, 222, 0.9)"
//         ctx.lineWidth = 1.5
//         ctx.shadowColor = source?.is_seed ? "#f5c842" : "#e4eade"
//         ctx.shadowBlur = 20
//         ctx.setLineDash([])
//         ctx.beginPath()
//         ctx.moveTo(start_dot.screen_x, start_dot.screen_y)
//         ctx.lineTo(mouse.x, mouse.y)
//         ctx.stroke()
//         ctx.shadowBlur = 0
//       }
//     }

//     function main_loop() {
//       ctx.clearRect(0, 0, canvas.width, canvas.height)

//       links.forEach(function(l) {
//         draw_link(l)
//       })

//       if (active_link) {
//         draw_link(active_link)
//       }

//       stars.forEach(function(s) {
//         camera_update(s)
//         detect_hover(s)
//         draw_star(s)
//       })

//       snapping_links = snapping_links.filter(function(sl) {
//         const elapsed = performance.now() - sl.created_at
//         const duration = 1200
//         if (elapsed > duration) return false

//         const from_star = stars[sl.from]
//         const to_star = stars[sl.to]
//         if (!from_star || !to_star) return false

//         const progress = elapsed / duration
//         const opacity = (1 - progress) * 0.9

//         ctx.strokeStyle = `rgba(228, 234, 222, ${opacity})`
//         ctx.lineWidth = 2.75 - progress * 2
//         ctx.shadowColor = `rgba(228, 234, 222, ${opacity})`
//         ctx.shadowBlur = 20 * (1 - progress)
//         ctx.beginPath()
//         ctx.moveTo(from_star.screen_x, from_star.screen_y)
//         ctx.lineTo(to_star.screen_x, to_star.screen_y)
//         ctx.stroke()
//         ctx.shadowBlur = 0

//         return true
//       })
//       animationId = requestAnimationFrame(main_loop)
//     }

//     function handleMouseMove(event: MouseEvent) {
//       const rect = canvas.getBoundingClientRect()
//       mouse.x = event.clientX - rect.left
//       mouse.y = event.clientY - rect.top

//       const dx = event.clientX - start_mouse.x
//       const dy = event.clientY - start_mouse.y

//       if (drag_star_index !== -1) {
//         const distance = Math.sqrt(dx * dx + dy * dy)
//         if (distance > 5) {
//           drag_threshold_crossed = true
//           active_link = null
//         }
//         if (drag_threshold_crossed) {
//           stars[drag_star_index].world_x += dx
//           stars[drag_star_index].world_y += dy
//           start_mouse.x = event.clientX
//           start_mouse.y = event.clientY
//         }
//         return
//       }

//       if (!is_dragging) return

//       camera.x -= dx
//       camera.y -= dy
//       start_mouse.x = event.clientX
//       start_mouse.y = event.clientY
//     }

//     function handleMouseDown(event: MouseEvent) {
//       if (active_input) return
    
//       let star_clicked = false

//       stars.forEach(function(s, index) {
//         if (s.is_hovered) {
//           drag_star_index = index
//           drag_threshold_crossed = false
//           start_mouse.x = event.clientX
//           start_mouse.y = event.clientY
//           star_clicked = true
//         }
//       })

//       if (!star_clicked) {
//         active_link = null
//         is_dragging = true
//         start_mouse.x = event.clientX
//         start_mouse.y = event.clientY
//       }
//     }

//     function handleMouseUp() {
//       is_dragging = false
//       canvas.style.cursor = ''

//       if (drag_star_index !== -1) {
//         if (!drag_threshold_crossed) {
//           if (active_link === null) {
//             active_link = { from: drag_star_index, to: null }
//           } else {
//             if (drag_star_index !== active_link.from) {
//               const new_link = { from: active_link.from, to: drag_star_index }
//               links.push(new_link)
//               snapping_links.push({ ...new_link, created_at: performance.now() })
//               active_link = null
//             } else {
//               active_link = null
//             }
//           }
//         }
//         drag_star_index = -1
//         drag_threshold_crossed = false
//       }
//     }

//     function handleDoubleClick(event: MouseEvent) {
//       if (active_input) return  // prevents multiple inputs

//       const rect = canvas.getBoundingClientRect()
//       const click_x = event.clientX - rect.left
//       const click_y = event.clientY - rect.top

//       let clicked_star_index = -1
//       stars.forEach(function(s, index) {
//         if (s.is_hovered) clicked_star_index = index
//       })

//       if (clicked_star_index !== -1 && stars[clicked_star_index].is_seed) return

//       const input = document.createElement('input')
//       input.type = 'text'

//       if (clicked_star_index !== -1) {
//         input.value = stars[clicked_star_index].text
//         input.placeholder = 'Edit your thought...'
//       } else {
//         input.placeholder = 'Type an idea, external or internal.'
//       }

//       input.style.position = 'fixed'
//       input.style.left = event.clientX + 20 + 'px'
//       input.style.top = event.clientY + 'px'
//       input.style.background = 'transparent'
//       input.style.border = 'none'
//       input.style.borderBottom = '1px solid #e8e4db'
//       input.style.color = '#e8e4db'
//       input.style.font = "14px 'Plus Jakarta Sans', sans-serif"
//       input.style.outline = 'none'
//       input.style.width = '280px'
//       input.style.zIndex = '1000'

//       // prevents click+drag inside input from moving the canvas
//       input.addEventListener('mousedown', function(e) {
//         e.stopPropagation()
//       })

//       // closes input when user clicks outside
//       input.addEventListener('blur', function() {
//         if (input.value.trim() === '') {
//           if (document.body.contains(input)) document.body.removeChild(input)
//           active_input = null
//         } else {
//           // has text — refocus so it stays open
//           requestAnimationFrame(() => input.focus())
//         }
//       })

//       input.addEventListener('keydown', function(e) {
//         if (e.key === 'Enter') {
//           const text = input.value
//           if (text.trim() !== '') {
//             if (clicked_star_index !== -1) {
//               stars[clicked_star_index].text = text
//             } else {
//               const world_x = click_x + camera.x
//               const world_y = click_y + camera.y
//               stars.push({
//                 world_x, world_y,
//                 screen_x: 0, screen_y: 0,
//                 radius: Math.random() * 4 + 3,
//                 text, glow: 15,
//                 is_hovered: false, 
//                 is_seed: false,
//                 birth_time: performance.now()
//               })
//             }
//           }
//           if (document.body.contains(input)) document.body.removeChild(input)
//           active_input = null
//         } else if (e.key === 'Escape') {
//           if (document.body.contains(input)) document.body.removeChild(input)
//           active_input = null
//         }
//       })

//       active_input = input
//       document.body.appendChild(input)
//       input.focus()
//       input.select()
//     }

//     function handleContextMenu(event: MouseEvent) {
//       event.preventDefault()

//       // check links first
//       let clicked_link_index = -1
//       links.forEach(function(l, index) {
//         const from_star = stars[l.from]
//         const to_star = l.to !== null ? stars[l.to] : null
//         if (!from_star || !to_star) return
//         const dist = point_to_line_distance(
//           mouse.x, mouse.y,
//           from_star.screen_x, from_star.screen_y,
//           to_star.screen_x, to_star.screen_y
//         )
//         if (dist < 12) clicked_link_index = index
//       })

//       if (clicked_link_index !== -1) {
//         links.splice(clicked_link_index, 1)
//         return
//       }

//       // then check stars
//       let clicked_star_index = -1
//       stars.forEach(function(s, index) {
//         if (s.is_hovered) clicked_star_index = index
//       })

//       if (clicked_star_index === -1) return
//       if (stars[clicked_star_index].is_seed) return

//       links = links.filter(function(l) {
//         return l.from !== clicked_star_index && l.to !== clicked_star_index
//       })

//       links = links.map(function(l) {
//         return {
//           from: l.from > clicked_star_index ? l.from - 1 : l.from,
//           to: l.to !== null && l.to > clicked_star_index ? l.to - 1 : l.to
//         }
//       })

//       stars.splice(clicked_star_index, 1)
//     }

//     resizeCanvas()
//     window.addEventListener('resize', resizeCanvas)
//     window.addEventListener('mousemove', handleMouseMove)
//     window.addEventListener('mousedown', handleMouseDown)
//     window.addEventListener('mouseup', handleMouseUp)
//     canvas.addEventListener('dblclick', handleDoubleClick)
//     canvas.addEventListener('contextmenu', handleContextMenu)
//     animationId = requestAnimationFrame(main_loop)

//     return () => {
//       cancelAnimationFrame(animationId)
//       window.removeEventListener('resize', resizeCanvas)
//       window.removeEventListener('mousemove', handleMouseMove)
//       window.removeEventListener('mousedown', handleMouseDown)
//       window.removeEventListener('mouseup', handleMouseUp)
//       canvas.removeEventListener('dblclick', handleDoubleClick)
//       canvas.removeEventListener('contextmenu', handleContextMenu)
//     }
//   }, [])

//   return (
//     <canvas
//       ref={canvasRef}
//       className="w-full h-full block"
//     />
//   )
// }
 