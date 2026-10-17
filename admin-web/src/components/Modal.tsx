import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, description, onClose, busy = false, children, slideOver = false }: {
  title: string; description?: string; onClose: () => void; busy?: boolean; children: ReactNode; slideOver?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    const previousFocus = document.activeElement
    dialog?.showModal()
    return () => { dialog?.close(); if (previousFocus instanceof HTMLElement) previousFocus.focus() }
  }, [])

  return (
    <dialog ref={ref} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
      aria-busy={busy} onCancel={event => { event.preventDefault(); onClose() }} className={`modal ${slideOver ? 'modal-panel' : ''}`}>
      <div className="flex items-start justify-between gap-4 border-b border-edge px-6 py-5">
        <div><h2 id={`${id}-title`} className="text-lg font-semibold">{title}</h2>{description && <p id={`${id}-description`} className="mt-1.5 text-sm leading-6 text-secondary">{description}</p>}</div>
        <button type="button" onClick={onClose} aria-label="Close dialog" className="button-quiet -mr-2"><X size={18} aria-hidden="true" /></button>
      </div>
      <div className="p-6">{children}</div>
    </dialog>
  )
}
