import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

type ToastKind = 'success' | 'error' | 'info'

export type ToastInput = {
  kind: ToastKind
  title: string
  message?: string
}

type ToastItem = ToastInput & {
  id: string
}

type ToastContextValue = {
  push: (t: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timeouts = useRef<Map<string, number>>(new Map())

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
    const h = timeouts.current.get(id)
    if (h) {
      window.clearTimeout(h)
      timeouts.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (t: ToastInput) => {
      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`
      const item: ToastItem = { ...t, id }
      setItems((prev) => [item, ...prev].slice(0, 5))
      const h = window.setTimeout(() => remove(id), 4500)
      timeouts.current.set(id, h)
    },
    [remove],
  )

  const value = useMemo<ToastContextValue>(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" role="region" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role="status" aria-live="polite">
            <div className="toast-head">
              <div className="toast-title">{t.title}</div>
              <button type="button" className="toast-x" onClick={() => remove(t.id)} aria-label="Dismiss">
                ×
              </button>
            </div>
            {t.message ? <div className="toast-msg">{t.message}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('ToastProvider is missing')
  return ctx
}
