import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
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

type TerminalNativeNotificationSender = TerminalNotificationSender;

type TerminalNotificationServiceOptions = {
  alert?: () => void;
  nativeSend?: TerminalNativeNotificationSender;
  send?: TerminalNotificationSender;
};

const TERMINAL_NOTIFIER_PATHS = [
  '/opt/homebrew/bin/terminal-notifier',
  '/usr/local/bin/terminal-notifier',
];

/**
 * Owns cli-v2 desktop notification delivery. Shared notification projection
 * stays in client-shared; this service only applies terminal-specific delivery
 * and duplicate suppression around node-notifier.
 */
export class ControlPlaneTerminalNotificationService {
  private readonly memory = new ClientSharedNotificationMemory();
  private readonly alert: () => void;
  private readonly nativeSend: TerminalNativeNotificationSender;
  private readonly send: TerminalNotificationSender;

  constructor(options: TerminalNotificationServiceOptions = {}) {
    this.alert = options.alert ?? (() => process.stdout.write('\u0007'));
    this.nativeSend = options.nativeSend ?? showNativeNotification;
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
      this.nativeSend({
        title: accepted.title,
        message: accepted.body ?? accepted.title,
        sound: accepted.tone === 'warning' || accepted.tone === 'error',
      });
    } catch {
      // Native notification delivery is best-effort and must never interrupt live event reduction.
    }

    try {
      this.alert();
    } catch {
      // Terminal attention is best-effort and must never interrupt live event reduction.
    }
  }
}

function showNativeNotification(message: { title: string; message: string; sound?: boolean }): void {
  if (process.platform !== 'darwin') {
    return;
  }

  const terminalNotifierPath = resolveTerminalNotifierPath();
  if (terminalNotifierPath) {
    execFile(terminalNotifierPath, [
      '-title',
      message.title,
      '-message',
      message.message,
      ...(message.sound ? ['-sound', 'default'] : []),
    ], (error) => {
      if (error) {
        showMacOsNotification(message);
      }
    });
    return;
  }

  showMacOsNotification(message);
}

function resolveTerminalNotifierPath(): string | undefined {
  return TERMINAL_NOTIFIER_PATHS.find((path) => existsSync(path));
}

function showMacOsNotification(message: { title: string; message: string }): void {
  execFile('/usr/bin/osascript', [
    '-e',
    `display notification "${escapeAppleScriptString(message.message)}" with title "${escapeAppleScriptString(message.title)}"`,
  ], () => undefined);
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
