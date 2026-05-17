import { useEffect, useRef } from 'react'
import { normalizeClassCode } from '../classCode'

/**
 * @param {{
 *   row: { classCode?: string, className?: string, displayName?: string },
 *   menuOpen: boolean,
 *   onMenuToggle: () => void,
 *   onMenuClose: () => void,
 *   onPick: () => void,
 *   onRename: () => void,
 *   onDelete: () => void,
 * }} props
 */
export function AdminTeacherClassCard({
  row,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  onPick,
  onRename,
  onDelete,
}) {
  const menuRef = useRef(null)
  const code = normalizeClassCode(row?.classCode)
  const title = (row?.displayName || row?.className || '').trim() || code

  useEffect(() => {
    if (!menuOpen) return undefined
    const onDocPointer = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onMenuClose()
      }
    }
    document.addEventListener('pointerdown', onDocPointer)
    return () => document.removeEventListener('pointerdown', onDocPointer)
  }, [menuOpen, onMenuClose])

  return (
    <div className="flex items-stretch gap-1 rounded-xl border border-blue-200 bg-white px-2 py-2 shadow-sm transition hover:border-blue-300 hover:shadow-md">
      <button
        type="button"
        onClick={onPick}
        className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition hover:bg-blue-50/80"
      >
        <span className="block text-base font-bold text-blue-950">{title}</span>
        <span className="mt-0.5 block font-mono text-xs font-semibold text-slate-500">({code})</span>
      </button>

      <div ref={menuRef} className="relative mr-0.5 flex shrink-0 items-center self-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMenuToggle()
          }}
          aria-label={`${title} 메뉴`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className={[
            'flex h-7 w-7 items-center justify-center rounded-md border text-[15px] leading-none transition',
            menuOpen
              ? 'border-slate-300 bg-slate-100/90 text-slate-600'
              : 'border-slate-200/80 bg-white/60 text-slate-400 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600',
            'outline-none focus-visible:ring-2 focus-visible:ring-blue-200/70 focus-visible:ring-offset-1',
          ].join(' ')}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[8.25rem] overflow-hidden rounded-lg border border-slate-200/90 bg-white py-0.5 shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={(e) => {
                e.stopPropagation()
                onMenuClose()
                onRename()
              }}
            >
              이름 변경
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-50"
              onClick={(e) => {
                e.stopPropagation()
                onMenuClose()
                onDelete()
              }}
            >
              삭제
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
