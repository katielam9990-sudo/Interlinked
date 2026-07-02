"use client"

import { useRef, useEffect } from "react"

type Seed = {
  text: string
  x: number
  y: number
}

export function ConstellationCanvas({ seeds }: { seeds: Seed[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    if (!ctx) return

    let mouse = { x: 0, y: 0 }
    let camera = { x: 40, y: -30 }
    let stars = spawn_seeds()
    let links: { from: number; to: number | null }[] = []
    let active_link: { from: number; to: number | null } | null = null
    let is_dragging = false
    let start_mouse = { x: 0, y: 0 }
    let animationId: number
    let drag_star_index = -1
    let drag_threshold_crossed = false
    let snapping_links: { from: number; to: number; created_at: number }[] = []
    let active_input: HTMLInputElement | null = null

    function spawn_seeds() {
      return seeds.map((seed) => ({
        world_x: seed.x,
        world_y: seed.y,
        screen_x: 0,
        screen_y: 0,
        radius: 6,
        text: seed.text,
        glow: 15,
        is_hovered: false,
        is_seed: true
      }))
    }

    function resizeCanvas() {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }

    function camera_update(star: typeof stars[0]) {
      star.screen_x = star.world_x - camera.x
      star.screen_y = star.world_y - camera.y
    }

    function detect_hover(star: typeof stars[0]) {
      const dx = mouse.x - star.screen_x
      const dy = mouse.y - star.screen_y
      const distance = Math.sqrt(dx * dx + dy * dy)
      star.is_hovered = distance < star.radius + 10
      star.glow = star.is_hovered ? 25 : 17
    }

    function point_to_line_distance(
      px: number, py: number,
      ax: number, ay: number,
      bx: number, by: number
    ) {
      const dx = bx - ax
      const dy = by - ay
      const len_sq = dx * dx + dy * dy
      if (len_sq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
      let t = ((px - ax) * dx + (py - ay) * dy) / len_sq
      t = Math.max(0, Math.min(1, t))
      const closest_x = ax + t * dx
      const closest_y = ay + t * dy
      return Math.sqrt((px - closest_x) ** 2 + (py - closest_y) ** 2)
    }

    function draw_star(star: typeof stars[0]) {
      const is_selected = active_link !== null && stars[active_link.from] === star

      ctx.fillStyle = star.is_seed ? "#f5c842" : "#e4eade"
      ctx.shadowColor = star.is_seed ? "#f5c842" : "#e8e4db"
      ctx.shadowBlur = is_selected ? 35 : star.glow

      const display_radius = is_selected ? star.radius * 1.4 : star.radius

      ctx.beginPath()
      ctx.arc(star.screen_x, star.screen_y, display_radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0

      if (is_selected) {
        ctx.strokeStyle = star.is_seed
          ? "rgba(245, 200, 66, 0.35)"
          : "rgba(228, 234, 222, 0.35)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(star.screen_x, star.screen_y, display_radius + 9, 0, Math.PI * 2)
        ctx.stroke()
      }

      if (star.is_hovered || is_selected) {
        ctx.font = "14px 'Plus Jakarta Sans'"
        ctx.fillStyle = star.is_seed ? "#f5c842" : "#e8e4db"
        ctx.fillText(star.text, star.screen_x + display_radius + 10, star.screen_y + 5)
      }
    }

    function draw_link(link: { from: number; to: number | null }) {
      const start_dot = stars[link.from]
      const end_dot = link.to !== null ? stars[link.to] : null
      if (!start_dot) return

      if (start_dot && end_dot) {
        ctx.strokeStyle = "#4f5d4e"
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(start_dot.screen_x, start_dot.screen_y)
        ctx.lineTo(end_dot.screen_x, end_dot.screen_y)
        ctx.stroke()
      } else {
        const source = stars[link.from]
        ctx.strokeStyle = source?.is_seed
          ? "rgba(245, 200, 66, 0.9)"
          : "rgba(228, 234, 222, 0.9)"
        ctx.lineWidth = 1.5
        ctx.shadowColor = source?.is_seed ? "#f5c842" : "#e4eade"
        ctx.shadowBlur = 20
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(start_dot.screen_x, start_dot.screen_y)
        ctx.lineTo(mouse.x, mouse.y)
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    }

    function main_loop() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      links.forEach(function(l) {
        draw_link(l)
      })

      if (active_link) {
        draw_link(active_link)
      }

      stars.forEach(function(s) {
        camera_update(s)
        detect_hover(s)
        draw_star(s)
      })

      snapping_links = snapping_links.filter(function(sl) {
        const elapsed = performance.now() - sl.created_at
        const duration = 1200
        if (elapsed > duration) return false

        const from_star = stars[sl.from]
        const to_star = stars[sl.to]
        if (!from_star || !to_star) return false

        const progress = elapsed / duration
        const opacity = (1 - progress) * 0.9

        ctx.strokeStyle = `rgba(228, 234, 222, ${opacity})`
        ctx.lineWidth = 2.75 - progress * 2
        ctx.shadowColor = `rgba(228, 234, 222, ${opacity})`
        ctx.shadowBlur = 20 * (1 - progress)
        ctx.beginPath()
        ctx.moveTo(from_star.screen_x, from_star.screen_y)
        ctx.lineTo(to_star.screen_x, to_star.screen_y)
        ctx.stroke()
        ctx.shadowBlur = 0

        return true
      })
      animationId = requestAnimationFrame(main_loop)
    }

    function handleMouseMove(event: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      mouse.x = event.clientX - rect.left
      mouse.y = event.clientY - rect.top

      const dx = event.clientX - start_mouse.x
      const dy = event.clientY - start_mouse.y

      if (drag_star_index !== -1) {
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance > 5) {
          drag_threshold_crossed = true
          active_link = null
        }
        if (drag_threshold_crossed) {
          stars[drag_star_index].world_x += dx
          stars[drag_star_index].world_y += dy
          start_mouse.x = event.clientX
          start_mouse.y = event.clientY
        }
        return
      }

      if (!is_dragging) return

      camera.x -= dx
      camera.y -= dy
      start_mouse.x = event.clientX
      start_mouse.y = event.clientY
    }

    function handleMouseDown(event: MouseEvent) {
      let star_clicked = false

      stars.forEach(function(s, index) {
        if (s.is_hovered) {
          drag_star_index = index
          drag_threshold_crossed = false
          start_mouse.x = event.clientX
          start_mouse.y = event.clientY
          star_clicked = true
        }
      })

      if (!star_clicked) {
        active_link = null
        is_dragging = true
        start_mouse.x = event.clientX
        start_mouse.y = event.clientY
      }
    }

    function handleMouseUp() {
      is_dragging = false
      canvas.style.cursor = ''

      if (drag_star_index !== -1) {
        if (!drag_threshold_crossed) {
          if (active_link === null) {
            active_link = { from: drag_star_index, to: null }
          } else {
            if (drag_star_index !== active_link.from) {
              const new_link = { from: active_link.from, to: drag_star_index }
              links.push(new_link)
              snapping_links.push({ ...new_link, created_at: performance.now() })
              active_link = null
            } else {
              active_link = null
            }
          }
        }
        drag_star_index = -1
        drag_threshold_crossed = false
      }
    }

    function handleDoubleClick(event: MouseEvent) {
      if (active_input) return  // prevents multiple inputs

      const rect = canvas.getBoundingClientRect()
      const click_x = event.clientX - rect.left
      const click_y = event.clientY - rect.top

      let clicked_star_index = -1
      stars.forEach(function(s, index) {
        if (s.is_hovered) clicked_star_index = index
      })

      if (clicked_star_index !== -1 && stars[clicked_star_index].is_seed) return

      const input = document.createElement('input')
      input.type = 'text'

      if (clicked_star_index !== -1) {
        input.value = stars[clicked_star_index].text
        input.placeholder = 'Edit your thought...'
      } else {
        input.placeholder = 'Type an idea, external or internal.'
      }

      input.style.position = 'fixed'
      input.style.left = event.clientX + 20 + 'px'
      input.style.top = event.clientY + 'px'
      input.style.background = 'transparent'
      input.style.border = 'none'
      input.style.borderBottom = '1px solid #e8e4db'
      input.style.color = '#e8e4db'
      input.style.font = "14px 'Plus Jakarta Sans', sans-serif"
      input.style.outline = 'none'
      input.style.width = '280px'
      input.style.zIndex = '1000'

      // prevents click+drag inside input from moving the canvas
      input.addEventListener('mousedown', function(e) {
        e.stopPropagation()
      })

      // closes input when user clicks outside
      input.addEventListener('blur', function() {
        if (document.body.contains(input)) document.body.removeChild(input)
        active_input = null
      })

      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          const text = input.value
          if (text.trim() !== '') {
            if (clicked_star_index !== -1) {
              stars[clicked_star_index].text = text
            } else {
              const world_x = click_x + camera.x
              const world_y = click_y + camera.y
              stars.push({
                world_x, world_y,
                screen_x: 0, screen_y: 0,
                radius: Math.random() * 4 + 3,
                text, glow: 15,
                is_hovered: false, is_seed: false
              })
            }
          }
          if (document.body.contains(input)) document.body.removeChild(input)
          active_input = null
        } else if (e.key === 'Escape') {
          if (document.body.contains(input)) document.body.removeChild(input)
          active_input = null
        }
      })

      active_input = input
      document.body.appendChild(input)
      input.focus()
      input.select()
    }

    function handleContextMenu(event: MouseEvent) {
      event.preventDefault()

      // check links first
      let clicked_link_index = -1
      links.forEach(function(l, index) {
        const from_star = stars[l.from]
        const to_star = l.to !== null ? stars[l.to] : null
        if (!from_star || !to_star) return
        const dist = point_to_line_distance(
          mouse.x, mouse.y,
          from_star.screen_x, from_star.screen_y,
          to_star.screen_x, to_star.screen_y
        )
        if (dist < 12) clicked_link_index = index
      })

      if (clicked_link_index !== -1) {
        links.splice(clicked_link_index, 1)
        return
      }

      // then check stars
      let clicked_star_index = -1
      stars.forEach(function(s, index) {
        if (s.is_hovered) clicked_star_index = index
      })

      if (clicked_star_index === -1) return
      if (stars[clicked_star_index].is_seed) return

      links = links.filter(function(l) {
        return l.from !== clicked_star_index && l.to !== clicked_star_index
      })

      links = links.map(function(l) {
        return {
          from: l.from > clicked_star_index ? l.from - 1 : l.from,
          to: l.to !== null && l.to > clicked_star_index ? l.to - 1 : l.to
        }
      })

      stars.splice(clicked_star_index, 1)
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('dblclick', handleDoubleClick)
    canvas.addEventListener('contextmenu', handleContextMenu)
    animationId = requestAnimationFrame(main_loop)

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resizeCanvas)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      canvas.removeEventListener('dblclick', handleDoubleClick)
      canvas.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
    />
  )
}
 