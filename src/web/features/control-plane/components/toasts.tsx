import { useCallback, useState } from 'react';
import { className } from '../utils';

export type ToastTone = 'info' | 'success' | 'error';

export type ToastInput = {
  title: string;
  body?: string;
  tone?: ToastTone;
};

export type ToastItem = ToastInput & {
  id: number;
};

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((toast: ToastInput) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    window.setTimeout(() => removeToast(id), toast.tone === 'error' ? 7000 : 4200);
  }, [removeToast]);

  return { toasts, addToast, removeToast };
}

export function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) {
    return null;
  }

  return (
    <div className="toast-viewport" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <article key={toast.id} className={className('toast', toast.tone ?? 'info')}>
          <div>
            <p className="toast-title">{toast.title}</p>
            {toast.body ? <p className="toast-body">{toast.body}</p> : null}
          </div>
          <button className="toast-dismiss" type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            x
          </button>
        </article>
      ))}
    </div>
  );
}
