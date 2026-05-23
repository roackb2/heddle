import type { PropsWithChildren } from 'react';

// ConversationWorkspace owns the central agent conversation/work surface.
// Feature views render inside it and should stay API-backed.
export function ConversationWorkspace({ children }: PropsWithChildren) {
  return (
    <main id="main-content" className="v2-workbench-frame h-full min-h-0 min-w-0">
      {children}
    </main>
  );
}
