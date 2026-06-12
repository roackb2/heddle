import notifier from 'node-notifier';
import {
  ClientSharedNotificationMemory,
  type ClientSharedNotificationIntent,
} from '@/client-shared/services/notifications/index.js';

type TerminalNotificationSender = (message: {
  title: string;
  message: string;
  sound?: boolean;
}) => void;

type TerminalNotificationServiceOptions = {
  alert?: () => void;
  send?: TerminalNotificationSender;
};

/**
 * Owns cli-v2 desktop notification delivery. Shared notification projection
 * stays in client-shared; this service only applies terminal-specific delivery
 * and duplicate suppression around node-notifier.
 */
export class ControlPlaneTerminalNotificationService {
  private readonly memory = new ClientSharedNotificationMemory();
  private readonly alert: () => void;
  private readonly send: TerminalNotificationSender;

  constructor(options: TerminalNotificationServiceOptions = {}) {
    this.alert = options.alert ?? (() => process.stdout.write('\u0007'));
    this.send = options.send ?? ((message) => notifier.notify(message));
  }

  deliver(intent: ClientSharedNotificationIntent | undefined): void {
    const accepted = this.memory.accept(intent);
    if (!accepted) {
      return;
    }

    try {
      this.send({
        title: accepted.title,
        message: accepted.body ?? accepted.title,
        sound: accepted.tone === 'warning' || accepted.tone === 'error',
      });
    } catch {
      // Notification delivery is best-effort and must never interrupt live event reduction.
    }

    try {
      this.alert();
    } catch {
      // Terminal attention is best-effort and must never interrupt live event reduction.
    }
  }
}
