// Copyright (C) 2026 Gabe Levine
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { makeRuntime } from '../src/runtime.js';

// A stub runner records calls and returns canned output per command, so we can
// assert exact argv and snapshot assembly with no droplet.
function stubRun(responses = {}) {
  const calls = [];
  const run = async (command, args = []) => {
    calls.push({ command, args });
    const key = `${command} ${args.join(' ')}`;
    const match = Object.entries(responses).find(([prefix]) => key.includes(prefix));
    const r = match ? match[1] : {};
    return { ok: r.ok ?? true, code: r.code ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', cmd: key };
  };
  run.calls = calls;
  return run;
}

const config = { claudeRcRoot: '/home/u/claude-rc-server', projectsDir: '/home/u/projects', tmuxSocket: 'claude-rc', assumeChaosToken: true, dryRun: false };

describe('runtime command construction', () => {
  it('addRepo shells out to add-repo.sh with url + validated name', async () => {
    const run = stubRun();
    const rt = makeRuntime({ run, config });
    await rt.addRepo({ gitUrl: 'git@github.com:gabelev/putu.git', name: 'putu' });
    expect(run.calls[0]).toEqual({
      command: 'bash',
      args: ['/home/u/claude-rc-server/scripts/add-repo.sh', 'git@github.com:gabelev/putu.git', 'putu'],
    });
  });

  it('start/stop/restart build the right systemctl --user argv', async () => {
    const run = stubRun();
    const rt = makeRuntime({ run, config });
    await rt.startServer('putu');
    await rt.stopServer('putu');
    await rt.restart('putu');
    await rt.restart(); // all
    expect(run.calls.map((c) => c.args.join(' '))).toEqual([
      '--user start claude-rc@putu',
      '--user stop claude-rc@putu',
      '--user restart claude-rc@putu',
      '--user restart claude-rc@*',
    ]);
  });

  it('rejects an unsafe repo name before it reaches systemctl', async () => {
    const run = stubRun();
    const rt = makeRuntime({ run, config });
    await expect(rt.startServer('putu; rm -rf /')).rejects.toThrow(/invalid name/);
    await expect(rt.addRepo({ gitUrl: 'x', name: 'a b' })).rejects.toThrow(/invalid name/);
    expect(run.calls).toHaveLength(0);
  });

  it('requires a git_url for addRepo', async () => {
    const rt = makeRuntime({ run: stubRun(), config });
    await expect(rt.addRepo({})).rejects.toThrow(/git_url/);
  });
});

describe('statusSnapshot assembly', () => {
  it('joins units, tmux sessions, and free into a typed snapshot', async () => {
    const run = stubRun({
      'list-units': { stdout: 'claude-rc@putu.service loaded active running Claude (putu)\nclaude-rc@law.service loaded inactive dead Claude (law)' },
      'list-sessions': { stdout: 'claude-putu: 1 windows (created x)\nclaude-putu: 1 windows (created y) (attached)' },
      'free -b': { stdout: 'Mem: 1000 400 600 0 0 700' },
    });
    const rt = makeRuntime({ run, config });
    const snap = await rt.statusSnapshot();
    expect(snap.servers).toEqual([
      { repo: 'putu', active: 'active', sub: 'running', sessions: 2 },
      { repo: 'law', active: 'inactive', sub: 'dead', sessions: 0 },
    ]);
    expect(snap.memory).toEqual({ totalBytes: 1000, usedBytes: 400, freeBytes: 600, availableBytes: 700 });
    expect(snap.warnings).toEqual([]); // assumeChaosToken true, not dry-run
  });

  it('warns when a Chaos Dimension token is not assumed configured', async () => {
    const rt = makeRuntime({ run: stubRun(), config: { ...config, assumeChaosToken: false } });
    const snap = await rt.statusSnapshot();
    expect(snap.warnings.some((w) => /Chaos Dimension MCP token/.test(w))).toBe(true);
  });
});
