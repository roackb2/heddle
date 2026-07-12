/** Trimmed from the official AI Elements `conversation` registry component. */
import { ArrowDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useCallback } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { cn } from '../../lib/utils.js';

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    aria-live="polite"
    className={cn('relative min-h-0 flex-1 overflow-y-hidden', className)}
    initial="instant"
    resize="instant"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn('flex flex-col gap-8 p-5 sm:p-8', className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string;
  description?: string;
};

export const ConversationEmptyState = ({
  className,
  title = 'No messages yet',
  description = 'Send a message below to start this conversation.',
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      'flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center',
      className,
    )}
    {...props}
  >
    <h2 className="text-balance text-lg font-medium text-slate-100">{title}</h2>
    <p className="max-w-md text-pretty text-sm text-slate-400">{description}</p>
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<'button'>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const handleScrollToBottom = useCallback(() => scrollToBottom(), [scrollToBottom]);

  if (isAtBottom) {
    return null;
  }

  return (
    <button
      aria-label="Scroll to latest message"
      className={cn(
        'absolute bottom-4 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-300 shadow-sm hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
        className,
      )}
      onClick={handleScrollToBottom}
      type="button"
      {...props}
    >
      <ArrowDownIcon aria-hidden="true" className="size-4" />
    </button>
  );
};
