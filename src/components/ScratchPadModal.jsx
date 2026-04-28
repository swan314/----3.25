import { useEffect, useRef, useState } from 'react'

export default function ScratchPadModal({ open, onClose }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const isDrawingRef = useRef(false)
  const [tool, setTool] = useState('pen')
  const [position, setPosition] = useState({ x: 16, y: 16 })
  const dragRef = useRef({
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 16,
    originY: 16,
  })

  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const dpr = window.devicePixelRatio || 1
    const rect = wrap.getBoundingClientRect()
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [open])

  if (!open) return null

  const handleDragStart = (event) => {
    if (event.target instanceof Element && event.target.closest('button')) return
    if (event.button !== 0 && event.pointerType !== 'touch' && event.pointerType !== 'pen') return
    dragRef.current = {
      dragging: true,
      pointerId: event.pointerId ?? null,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    }
  }

  const handleDragMove = (event) => {
    const state = dragRef.current
    if (!state.dragging) return
    if (state.pointerId != null && event.pointerId !== state.pointerId) return

    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    const nextX = Math.max(8, state.originX - dx)
    const nextY = Math.max(8, state.originY - dy)
    setPosition({ x: nextX, y: nextY })
  }

  const handleDragEnd = (event) => {
    const state = dragRef.current
    if (!state.dragging) return
    if (state.pointerId != null && event.pointerId !== state.pointerId) return
    dragRef.current.dragging = false
    dragRef.current.pointerId = null
  }

  const getPoint = (event) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  const drawLine = (event) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !isDrawingRef.current) return

    const { x, y } = getPoint(event)
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineWidth = 18
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 2
    }
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const handlePointerDown = (event) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { x, y } = getPoint(event)
    isDrawingRef.current = true
    canvas.setPointerCapture?.(event.pointerId)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const handlePointerUp = (event) => {
    const canvas = canvasRef.current
    isDrawingRef.current = false
    canvas?.releasePointerCapture?.(event.pointerId)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
  }

  return (
    <div
      className="fixed z-[9999] w-[min(50vw,760px)] min-w-[360px] max-w-[96vw] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
      style={{ right: `${position.x}px`, bottom: `${position.y}px` }}
      onPointerMove={handleDragMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
      onPointerLeave={handleDragEnd}
    >
        <div
          className="mb-3 flex cursor-move items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5"
          onPointerDown={handleDragStart}
        >
          <h3 className="text-base font-extrabold text-slate-800">연습장</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTool('pen')}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                tool === 'pen' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white'
              }`}
            >
              펜
            </button>
            <button
              type="button"
              onClick={() => setTool('eraser')}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                tool === 'eraser'
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-slate-300 bg-white'
              }`}
            >
              지우개
            </button>
            <button
              type="button"
              onClick={clearCanvas}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold"
            >
              전체 지우기
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-bold text-white"
            >
              닫기
            </button>
          </div>
        </div>

        <div ref={wrapRef} className="h-[54vh] min-h-[300px] overflow-hidden rounded-xl border border-slate-300">
          <canvas
            ref={canvasRef}
            className="h-full w-full touch-none bg-white"
            onPointerDown={handlePointerDown}
            onPointerMove={drawLine}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
    </div>
  )
}
