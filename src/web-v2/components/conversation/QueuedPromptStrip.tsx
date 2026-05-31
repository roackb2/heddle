import { useEffect, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import type { ControlPlaneSessionDetail } from '@web/api/client';
import { Button } from '@web/components/ui/button';

type QueuedPromptStripProps = {
  queuedPrompts: NonNullable<ControlPlaneSessionDetail>['queuedPrompts'];
  updating?: boolean;
  onUpdateQueuedPrompt?: (queueItemId: string, prompt: string) => Promise<void>;
  onDeleteQueuedPrompt?: (queueItemId: string) => Promise<void>;
};

export function QueuedPromptStrip({
  queuedPrompts,
  updating,
  onUpdateQueuedPrompt,
  onDeleteQueuedPrompt,
}: QueuedPromptStripProps) {
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editingPrompt, setEditingPrompt] = useState('');

  useEffect(() => {
    if (!editingId || queuedPrompts.some((prompt) => prompt.id === editingId)) {
      return;
    }

    setEditingId(undefined);
    setEditingPrompt('');
  }, [editingId, queuedPrompts]);

  if (!queuedPrompts.length) {
    return null;
  }

  const saveEditingPrompt = async () => {
    if (!editingId || !editingPrompt.trim()) {
      return;
    }

    await onUpdateQueuedPrompt?.(editingId, editingPrompt);
    setEditingId(undefined);
    setEditingPrompt('');
  };

  return (
    <div className="v2-queued-prompt-strip" aria-label="Queued follow-up prompts">
      {queuedPrompts.map((item, index) => {
        const editing = editingId === item.id;
        return (
          <div key={item.id} className="v2-queued-prompt-row" data-first={index === 0 ? 'true' : undefined}>
            {editing ? (
              <input
                className="v2-queued-prompt-input"
                value={editingPrompt}
                disabled={updating}
                autoFocus
                onChange={(event) => setEditingPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveEditingPrompt();
                  }

                  if (event.key === 'Escape') {
                    setEditingId(undefined);
                    setEditingPrompt('');
                  }
                }}
              />
            ) : (
              <span className="v2-queued-prompt-text truncate">{item.prompt}</span>
            )}
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                size="none"
                className="v2-queued-prompt-action"
                aria-label="Save queued prompt"
                disabled={updating || !editingPrompt.trim()}
                onClick={() => void saveEditingPrompt()}
              >
                <Check aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="none"
                className="v2-queued-prompt-action"
                aria-label="Edit queued prompt"
                disabled={updating || !onUpdateQueuedPrompt}
                onClick={() => {
                  setEditingId(item.id);
                  setEditingPrompt(item.prompt);
                }}
              >
                <Pencil aria-hidden="true" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="none"
              className="v2-queued-prompt-action"
              aria-label="Remove queued prompt"
              disabled={updating || !onDeleteQueuedPrompt}
              onClick={() => void onDeleteQueuedPrompt?.(item.id)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
