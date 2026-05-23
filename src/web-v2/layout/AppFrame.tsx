import type { PropsWithChildren } from 'react';
import { SidebarProvider } from '@web/components/ui/sidebar';
import { useIsMobile } from '@web/hooks/useIsMobile';
import { DesktopAppFrame } from '@web/layout/DesktopAppFrame';
import { MobileAppFrame } from '@web/layout/MobileAppFrame';
import type { AppFrameProps } from '@web/layout/AppFrameShared';

// AppFrame owns only shell selection. Desktop and mobile have different layout
// mechanics, but reuse the same lower-level shell content and workflow props.
export function AppFrame(props: PropsWithChildren<AppFrameProps>) {
  const isMobile = useIsMobile();
  const Frame = isMobile ? MobileAppFrame : DesktopAppFrame;

  return (
    <SidebarProvider className="v2-shell h-dvh overflow-hidden bg-background font-sans text-foreground">
      <Frame {...props} />
    </SidebarProvider>
  );
}
