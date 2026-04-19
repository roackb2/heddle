import * as React from 'react'

const TOAST_LIMIT = 3
const TOAST_REMOVE_DELAY = 7000

export type ToastTone = 'info' | 'success' | 'error'

export type ToastInput = {
  title: string
  body?: string
  tone?: ToastTone
}

type ToastItem = ToastInput & {
  id: string
  open: boolean
}

type ToastState = {
  toasts: ToastItem[]
}

type Action =
  | { type: 'ADD_TOAST'; toast: ToastItem }
  | { type: 'UPDATE_TOAST'; toast: Partial<ToastItem> & { id: string } }
  | { type: 'DISMISS_TOAST'; toastId?: string }
  | { type: 'REMOVE_TOAST'; toastId?: string }

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({ type: 'REMOVE_TOAST', toastId })
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

function reducer(state: ToastState, action: Action): ToastState {
  switch (action.type) {
    case 'ADD_TOAST':
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case 'UPDATE_TOAST':
      return {
        ...state,
        toasts: state.toasts.map((toast) =>
          toast.id === action.toast.id ? { ...toast, ...action.toast } : toast
        ),
      }

    case 'DISMISS_TOAST': {
      const { toastId } = action

      if (toastId) {
        addToRemoveQueue(toastId)
      } else {
        state.toasts.forEach((toast) => addToRemoveQueue(toast.id))
      }

      return {
        ...state,
        toasts: state.toasts.map((toast) =>
          toast.id === toastId || toastId === undefined
            ? {
                ...toast,
                open: false,
              }
            : toast
        ),
      }
    }

    case 'REMOVE_TOAST':
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((toast) => toast.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: ToastState) => void> = []

let memoryState: ToastState = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

export function toast(input: ToastInput) {
  const id = generateId()

  const dismiss = () => dispatch({ type: 'DISMISS_TOAST', toastId: id })
  const update = (next: Partial<ToastItem>) =>
    dispatch({
      type: 'UPDATE_TOAST',
      toast: {
        ...next,
        id,
      },
    })

  dispatch({
    type: 'ADD_TOAST',
    toast: {
      id,
      title: input.title,
      body: input.body,
      tone: input.tone,
      open: true,
    },
  })

  const dismissDelay = input.tone === 'error' ? TOAST_REMOVE_DELAY : 4200
  setTimeout(dismiss, dismissDelay)

  return {
    id,
    dismiss,
    update,
  }
}

export function useToast() {
  const [state, setState] = React.useState<ToastState>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }),
  }
}
