// Copyright (C) 2026 Gabe Levine
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { parseSystemctlUnits, parseTmuxSessions, parseFree } from '../src/parsers.js';

describe('parseSystemctlUnits', () => {
  it('parses --plain --no-legend rows into typed servers', () => {
    const out = [
      'claude-rc@putu.service        loaded active   running Claude Code Remote Control server (putu)',
      'claude-rc@secondseat.service  loaded inactive dead    Claude Code Remote Control server (secondseat)',
    ].join('\n');
    const rows = parseSystemctlUnits(out);
    expect(rows).toEqual([
      { repo: 'putu', unit: 'claude-rc@putu.service', load: 'loaded', active: 'active', sub: 'running', description: 'Claude Code Remote Control server (putu)' },
      { repo: 'secondseat', unit: 'claude-rc@secondseat.service', load: 'loaded', active: 'inactive', sub: 'dead', description: 'Claude Code Remote Control server (secondseat)' },
    ]);
  });

  it('ignores blank lines and non-matching units', () => {
    const out = '\n  \nsshd.service loaded active running OpenSSH\nclaude-rc@x.service loaded active running desc\n';
    const rows = parseSystemctlUnits(out);
    expect(rows).toHaveLength(1);
    expect(rows[0].repo).toBe('x');
  });

  it('returns [] for empty output', () => {
    expect(parseSystemctlUnits('')).toEqual([]);
  });
});

describe('parseTmuxSessions', () => {
  it('parses sessions and the attached flag', () => {
    const out = [
      'claude-putu: 1 windows (created Fri Jun 13 10:00:00 2026)',
      'claude-secondseat: 2 windows (created Fri Jun 13 11:00:00 2026) (attached)',
    ].join('\n');
    const rows = parseTmuxSessions(out);
    expect(rows).toEqual([
      { session: 'claude-putu', repo: 'putu', windows: 1, attached: false },
      { session: 'claude-secondseat', repo: 'secondseat', windows: 2, attached: true },
    ]);
  });

  it('returns [] when no tmux server is running (empty stdout)', () => {
    expect(parseTmuxSessions('')).toEqual([]);
    expect(parseTmuxSessions('no server running on /tmp/tmux-1000/claude-rc')).toEqual([]);
  });
});

describe('parseFree', () => {
  it('parses the Mem line into bytes incl. available', () => {
    const out = [
      '               total        used        free      shared  buff/cache   available',
      'Mem:     8323477504  1234567890  2000000000   100000000  3000000000  5123456789',
      'Swap:    4294967296           0  4294967296',
    ].join('\n');
    expect(parseFree(out)).toEqual({
      totalBytes: 8323477504,
      usedBytes: 1234567890,
      freeBytes: 2000000000,
      availableBytes: 5123456789,
    });
  });

  it('falls back to free when no available column', () => {
    expect(parseFree('Mem: 1000 400 600')).toEqual({ totalBytes: 1000, usedBytes: 400, freeBytes: 600, availableBytes: 600 });
  });

  it('returns null when there is no Mem line', () => {
    expect(parseFree('garbage')).toBeNull();
  });
});
