import { execFile } from 'node:child_process';
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
  terminalSend?: TerminalNotificationSender;
};

/**
 * Owns cli-v2 desktop notification delivery. Shared notification projection
 * stays in client-shared; this service only applies terminal-specific delivery
 * and duplicate suppression around terminal delivery.
 */
export class ControlPlaneTerminalNotificationService {
  private readonly memory = new ClientSharedNotificationMemory();
  private readonly alert: () => void;
  private readonly nativeSend: TerminalNativeNotificationSender;
  private readonly terminalSend: TerminalNotificationSender;

  constructor(options: TerminalNotificationServiceOptions = {}) {
    this.alert = options.alert ?? (() => process.stdout.write('\u0007'));
    this.nativeSend = options.nativeSend ?? showNativeNotification;
    this.terminalSend = options.terminalSend ?? showWarpTerminalNotification;
  }

  deliver(intent: ClientSharedNotificationIntent | undefined): void {
    const accepted = this.memory.accept(intent);
    if (!accepted) {
      return;
    }

    const sound = accepted.tone !== 'info';

    try {
      this.nativeSend({
        title: accepted.title,
        message: accepted.body ?? accepted.title,
        sound,
      });
    } catch {
      // Native notification delivery is best-effort and must never interrupt live event reduction.
    }

    try {
      this.terminalSend({
        title: accepted.title,
        message: accepted.body ?? accepted.title,
        sound,
      });
    } catch {
      // Terminal-native notification delivery is best-effort and must never interrupt live event reduction.
    }

    try {
      this.alert();
    } catch {
      // Terminal attention is best-effort and must never interrupt live event reduction.
    }
  }
}

function showNativeNotification(message: { title: string; message: string; sound?: boolean }): void {
  if (process.platform !== 'darwin' || isWarpTerminal()) {
    return;
  }

  showMacOsNotification(message);
}

function showMacOsNotification(message: { title: string; message: string; sound?: boolean }): void {
  const soundClause = message.sound ? ' sound name "Glass"' : '';

  execFile('/usr/bin/osascript', [
    '-e',
    `display notification "${escapeAppleScriptString(message.message)}" with title "${escapeAppleScriptString(message.title)}"${soundClause}`,
  ], () => undefined);
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function showWarpTerminalNotification(message: { title: string; message: string }): void {
  if (!isWarpTerminal()) {
    return;
  }

  process.stdout.write([
    '\u001b]777;notify;',
    escapeTerminalNotificationPayload(message.title),
    ';',
    escapeTerminalNotificationPayload(message.message),
    '\u0007',
  ].join(''));
}

function isWarpTerminal(): boolean {
  return process.env.TERM_PROGRAM === 'WarpTerminal' || process.env.WARP_IS_LOCAL_SHELL_SESSION === '1';
}

function escapeTerminalNotificationPayload(value: string): string {
  return Array.from(value)
    .map((char) => isTerminalNotificationSafeChar(char) ? char : ' ')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTerminalNotificationSafeChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return char !== ';' && code >= 32 && code !== 127;
}
