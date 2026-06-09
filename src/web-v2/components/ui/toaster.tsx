import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast'
import { useToast } from './use-toast'

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <ToastProvider>
      {toasts.map((item) => (
        <Toast
          key={item.id}
          open={item.open}
          onOpenChange={(open) => {
            if (!open) {
              dismiss(item.id)
            }
          }}
          variant={item.tone ?? 'info'}
        >
          <div>
            <ToastTitle>{item.title}</ToastTitle>
            {item.body ? <ToastDescription>{item.body}</ToastDescription> : null}
          </div>
          {item.action ? (
            <ToastAction
              altText={item.action.label}
              onClick={() => {
                void item.action?.onClick()
              }}
            >
              {item.action.label}
            </ToastAction>
          ) : null}
          <ToastClose aria-label="Dismiss notification" />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
