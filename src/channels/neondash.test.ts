import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NeonDashChannel } from './neondash.js';
import type { ChannelOpts } from './registry.js';

vi.mock('socket.io', () => {
  const Server = vi.fn().mockImplementation(() => ({
    use: vi.fn(),
    on: vi.fn(),
    close: vi.fn((cb: () => void) => cb()),
  }));
  return { Server };
});

vi.mock('http', () => ({
  default: {
    createServer: () => ({ listen: (_p: number, cb: () => void) => cb() }),
  },
}));

function makeOpts(overrides: Partial<ChannelOpts> = {}): ChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: () => ({}),
    registerGroup: vi.fn(),
    clearGroupSession: vi.fn(),
    ...overrides,
  };
}

describe('NeonDashChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ownsJid returns true for nd_ prefix', () => {
    const ch = new NeonDashChannel(makeOpts(), 6001, null);
    expect(ch.ownsJid('nd_abc123')).toBe(true);
    expect(ch.ownsJid('somegroup@g.us')).toBe(false);
  });

  it('isConnected returns false before connect()', () => {
    const ch = new NeonDashChannel(makeOpts(), 6001, null);
    expect(ch.isConnected()).toBe(false);
  });

  it('name is neondash', () => {
    const ch = new NeonDashChannel(makeOpts(), 6001, null);
    expect(ch.name).toBe('neondash');
  });
});
