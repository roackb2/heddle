import { SendIcon, SquareIcon } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';

type ConversationComposerProps = {
  disabled: boolean;
  isRunning: boolean;
  isStarting: boolean;
  isStopping: boolean;
  error?: string;
  recoveryWarning?: string;
  onSubmit(prompt: string): Promise<boolean>;
  onStop(): Promise<void>;
  onRetryConnection(): void;
};

export function ConversationComposer({
  disabled,
  isRunning,
  isStarting,
  isStopping,
  error,
  recoveryWarning,
  onSubmit,
  onStop,
  onRetryConnection,
}: ConversationComposerProps) {
  const [prompt, setPrompt] = useState('');

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (await onSubmit(prompt)) {
      setPrompt('');
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form className="space-y-3 border-t border-slate-800 pt-4" onSubmit={submit}>
      <label className="sr-only" htmlFor="hosted-agent-prompt">Message the agent</label>
      <textarea
        className="min-h-24 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled || isRunning || isStarting}
        id="hosted-agent-prompt"
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask the agent to inspect or explain this repository…"
        value={prompt}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-pretty text-xs text-slate-500">Ctrl/⌘ + Enter to send</p>
        {isRunning ? (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-sm font-medium text-slate-200 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60"
            disabled={isStopping}
            onClick={() => void onStop()}
            type="button"
          >
            <SquareIcon aria-hidden="true" className="size-3.5 fill-current" />
            {isStopping ? 'Stopping…' : 'Stop'}
          </button>
        ) : (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-sky-500 px-4 text-sm font-semibold text-slate-950 hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || isStarting || !prompt.trim()}
            type="submit"
          >
            <SendIcon aria-hidden="true" className="size-4" />
            {isStarting ? 'Starting…' : 'Send'}
          </button>
        )}
      </div>
      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200" role="alert">
          <span className="text-pretty">{error}</span>
          {isRunning ? (
            <button
              className="font-medium underline underline-offset-4"
              onClick={onRetryConnection}
              type="button"
            >
              Reconnect
            </button>
          ) : null}
        </div>
      ) : null}
      {recoveryWarning ? (
        <p className="text-pretty text-xs text-amber-300" role="status">{recoveryWarning}</p>
      ) : null}
    </form>
  );
}
