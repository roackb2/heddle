/**
 * Trimmed from the official AI Elements `message` registry component.
 * The example keeps only the message primitives it uses while retaining the
 * Streamdown renderer for generated Markdown.
 */
import type { ComponentProps, HTMLAttributes } from 'react';
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '../../lib/utils.js';

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: 'user' | 'assistant';
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      'group flex w-full max-w-[95%] flex-col gap-2',
      from === 'user' ? 'is-user ml-auto items-end' : 'is-assistant',
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      'flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm text-slate-100',
      'group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-slate-800 group-[.is-user]:px-4 group-[.is-user]:py-3',
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        'size-full text-pretty [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
      {...props}
    />
  ),
  (previous, next) => (
    previous.children === next.children
    && previous.isAnimating === next.isAnimating
  ),
);

MessageResponse.displayName = 'MessageResponse';
