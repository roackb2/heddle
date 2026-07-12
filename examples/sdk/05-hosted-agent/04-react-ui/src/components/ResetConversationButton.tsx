import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { RotateCcwIcon } from 'lucide-react';

type ResetConversationButtonProps = {
  disabled: boolean;
  isResetting: boolean;
  onReset(): Promise<void>;
};

export function ResetConversationButton({
  disabled,
  isResetting,
  onReset,
}: ResetConversationButtonProps) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-sm text-slate-300 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          type="button"
        >
          <RotateCcwIcon aria-hidden="true" className="size-4" />
          Reset
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-950/80" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-700 bg-slate-950 p-6 shadow-lg">
          <AlertDialog.Title className="text-balance text-lg font-semibold text-slate-100">
            Reset this conversation?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-pretty text-sm text-slate-400">
            This clears the persisted messages for this example session. It cannot be undone.
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <button
                className="h-9 rounded-md border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                type="button"
              >
                Keep conversation
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="h-9 rounded-md bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-60"
                disabled={isResetting}
                onClick={() => void onReset()}
                type="button"
              >
                {isResetting ? 'Resetting…' : 'Reset conversation'}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
