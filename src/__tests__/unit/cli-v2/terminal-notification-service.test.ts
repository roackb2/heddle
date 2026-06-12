import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneTerminalNotificationService } from '@/cli-v2/services/notifications/index.js';

describe('ControlPlaneTerminalNotificationService', () => {
  it('delivers deduplicated desktop notifications', () => {
    const alert = vi.fn();
    const nativeSend = vi.fn();
    const send = vi.fn();
    const terminalSend = vi.fn();
    const service = new ControlPlaneTerminalNotificationService({ alert, nativeSend, send, terminalSend });
    const intent = {
      key: 'session-approval:workspace-1:session-1:call-1',
      title: 'Approval required',
      body: 'Waiting for yarn test',
      tone: 'warning',
      timestamp: '2026-06-12T00:00:00.000Z',
    } as const;

    service.deliver(intent);
    service.deliver(intent);

    expect(alert).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      title: 'Approval required',
      message: 'Waiting for yarn test',
      sound: true,
    });
    expect(nativeSend).toHaveBeenCalledTimes(1);
    expect(nativeSend).toHaveBeenCalledWith({
      title: 'Approval required',
      message: 'Waiting for yarn test',
      sound: true,
    });
    expect(terminalSend).toHaveBeenCalledTimes(1);
    expect(terminalSend).toHaveBeenCalledWith({
      title: 'Approval required',
      message: 'Waiting for yarn test',
      sound: true,
    });
  });

  it('keeps live event processing best-effort when desktop delivery fails', () => {
    const alert = vi.fn();
    const nativeSend = vi.fn(() => {
      throw new Error('native notification unavailable');
    });
    const terminalSend = vi.fn(() => {
      throw new Error('terminal notification unavailable');
    });
    const send = vi.fn(() => {
      throw new Error('notification bridge unavailable');
    });
    const service = new ControlPlaneTerminalNotificationService({ alert, nativeSend, send, terminalSend });

    expect(() => service.deliver({
      key: 'session-finished:workspace-1:session-1:run-1',
      title: 'Session run finished',
      body: 'Done',
      tone: 'success',
      timestamp: '2026-06-12T00:00:00.000Z',
    })).not.toThrow();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(nativeSend).toHaveBeenCalledTimes(1);
    expect(terminalSend).toHaveBeenCalledTimes(1);
  });

  it('requests sound for successful completion notifications', () => {
    const alert = vi.fn();
    const nativeSend = vi.fn();
    const send = vi.fn();
    const terminalSend = vi.fn();
    const service = new ControlPlaneTerminalNotificationService({ alert, nativeSend, send, terminalSend });

    service.deliver({
      key: 'session-finished:workspace-1:session-1:run-1',
      title: 'Session run finished',
      body: 'Done',
      tone: 'success',
      timestamp: '2026-06-12T00:00:00.000Z',
    });

    expect(send).toHaveBeenCalledWith({
      title: 'Session run finished',
      message: 'Done',
      sound: true,
    });
    expect(nativeSend).toHaveBeenCalledWith({
      title: 'Session run finished',
      message: 'Done',
      sound: true,
    });
    expect(terminalSend).toHaveBeenCalledWith({
      title: 'Session run finished',
      message: 'Done',
      sound: true,
    });
  });
});
