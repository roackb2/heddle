import { useCallback, useMemo, useState } from 'react';
import {
  ClientSharedNotificationMemory,
  type ClientSharedNotificationIntent,
} from '@/client-shared/services/notifications';
import { toast } from '@web/components/ui/use-toast';

export type BrowserNotificationPermissionState = NotificationPermission | 'unsupported';

/**
 * Owns web-v2 delivery for shared notification intents. The shared projection
 * decides what deserves notification; this hook decides whether the browser can
 * show an OS notification or should fall back to an in-app toast.
 */
export function useControlPlaneNotifications() {
  const memory = useMemo(() => new ClientSharedNotificationMemory(), []);
  const [permission, setPermission] = useState<BrowserNotificationPermissionState>(readPermission());

  const deliver = useCallback((intent: ClientSharedNotificationIntent | undefined) => {
    const accepted = memory.accept(intent);
    if (!accepted) {
      return;
    }

    const currentPermission = readPermission();
    setPermission(currentPermission);
    if (currentPermission === 'granted') {
      const delivered = showBrowserNotification(accepted);
      if (!delivered) {
        setPermission(readPermission());
      }
    }

    showToastNotification(accepted);
  }, [memory]);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      setPermission('unsupported');
      return 'unsupported' as const;
    }

    const next = await Notification.requestPermission();
    setPermission(next);
    if (next === 'granted') {
      const intent = {
        title: 'Heddle notifications enabled',
        body: 'Approval and run completion notifications can now appear from this browser.',
        key: 'heddle-notifications-enabled',
        tone: 'success',
      } as const;
      showBrowserNotification(intent);
      showToastNotification(intent);
    }

    return next;
  }, []);

  return {
    deliver,
    permission,
    requestPermission,
  };
}

function readPermission(): BrowserNotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  return Notification.permission;
}

function showBrowserNotification(intent: Pick<ClientSharedNotificationIntent, 'title' | 'body' | 'key'>): boolean {
  try {
    new Notification(intent.title, {
      body: intent.body,
      tag: intent.key,
    });
    return true;
  } catch {
    return false;
  }
}

function showToastNotification(intent: Pick<ClientSharedNotificationIntent, 'title' | 'body' | 'tone'>): void {
  toast({
    title: intent.title,
    body: intent.body,
    tone: intent.tone === 'error' ? 'error' : intent.tone === 'success' ? 'success' : 'info',
  });
}
