import { GripVertical } from 'lucide-react';
import * as ResizablePrimitive from 'react-resizable-panels';
import { cn } from '@web/lib/utils';

const ResizablePanelGroup = ({
  className,
  direction,
  orientation,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group> & {
  direction?: 'horizontal' | 'vertical';
}) => (
  <ResizablePrimitive.Group
    className={cn('flex h-full w-full', className)}
    orientation={direction ?? orientation}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.Separator
    className={cn(
      'v2-resize-handle relative flex h-full w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
