import { describe, expect, it } from 'vitest';
import * as heddle from '../../../index.js';

describe('public API conversation engine exports', () => {
  it('exports the alpha conversation engine entry points from the package root', () => {
    expect(typeof heddle.createConversationEngine).toBe('function');
    expect(typeof heddle.runConversationTurn).toBe('function');
    expect(typeof heddle.clearConversationTurnLease).toBe('function');
  });
});
