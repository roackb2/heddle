import type { ReactNode } from 'react';

export function WorkspaceCard({ children }: { children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card/95 p-4 shadow-sm sm:p-5">
      {children}
    </section>
  );
}
