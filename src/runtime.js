// Copyright (C) 2026 Gabe Levine
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License, version 3.
//
// This program is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// Affero General Public License for more details.
import { join } from 'node:path';
import { assertSafeName } from './exec.js';
import { parseSystemctlUnits, parseTmuxSessions, parseFree } from './parsers.js';

// Typed wrappers over the claude-rc-server lifecycle. Every method drives the
// runtime through LOCAL `systemctl --user` / the runtime's own scripts / tmux —
// the same things a human runs by hand over SSH today. `run` is injected (the
// allowlisted execFile runner) so this whole module is testable with a stub.
export function makeRuntime({ run, config }) {
  const scriptsDir = join(config.claudeRcRoot, 'scripts');

  async function provision({ withMcp = true } = {}) {
    const steps = [];
    const install = await run('bash', [join(scriptsDir, 'install.sh')]);
    steps.push({ step: 'install', ...summarize(install) });
    if (withMcp) {
      const mcp = await run('bash', [join(scriptsDir, 'setup-mcp.sh')]);
      steps.push({ step: 'setup-mcp', ...summarize(mcp) });
    }
    return {
      ok: steps.every((s) => s.ok),
      steps,
      note: 'auth.sh is interactive (headless OAuth) and is NOT run here; run it once by hand, then conductor_status reports token health.',
    };
  }

  async function addRepo({ gitUrl, name } = {}) {
    if (!gitUrl || typeof gitUrl !== 'string') throw new Error('git_url is required');
    const args = [join(scriptsDir, 'add-repo.sh'), gitUrl];
    if (name) args.push(assertSafeName(name));
    const res = await run('bash', args);
    return { ok: res.ok, ...summarize(res) };
  }

  async function startServer(repo) {
    return unitAction('start', assertSafeName(repo));
  }
  async function stopServer(repo) {
    return unitAction('stop', assertSafeName(repo));
  }
  async function restart(repo) {
    // No repo -> restart every server (the claude-rc@* glob).
    const target = repo ? `claude-rc@${assertSafeName(repo)}` : 'claude-rc@*';
    const res = await run('systemctl', ['--user', 'restart', target]);
    return { ok: res.ok, target, ...summarize(res) };
  }

  async function unitAction(action, repo) {
    const res = await run('systemctl', ['--user', action, `claude-rc@${repo}`]);
    return { ok: res.ok, repo, action, ...summarize(res) };
  }

  // The M2 read-back: assemble a typed snapshot of what is actually running.
  async function statusSnapshot() {
    const [units, sessions, mem] = await Promise.all([
      run('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', 'claude-rc@*']),
      run('tmux', ['-L', config.tmuxSocket, 'list-sessions']),
      run('free', ['-b']),
    ]);

    const servers = parseSystemctlUnits(units.stdout);
    const tmuxSessions = parseTmuxSessions(sessions.stdout);
    const memory = parseFree(mem.stdout);

    const warnings = [];
    if (!config.assumeChaosToken) {
      warnings.push(
        'Could not confirm a Chaos Dimension MCP token is configured in claude-rc-server. If you rely on the board connection, verify the ~/.claude.json block directly (the known `claude mcp add --scope user` read-back bug). Set CONDUCTOR_ASSUME_TOKEN=1 to silence.',
      );
    }
    if (config.dryRun) warnings.push('CONDUCTOR_DRY_RUN is on: no commands were actually executed.');

    return {
      generatedAt: null, // stamped by the caller (keeps this fn deterministic/testable)
      runtime: { claudeRcRoot: config.claudeRcRoot, projectsDir: config.projectsDir, tmuxSocket: config.tmuxSocket },
      servers: servers.map((s) => ({
        repo: s.repo,
        active: s.active,
        sub: s.sub,
        sessions: tmuxSessions.filter((t) => t.repo === s.repo).length,
      })),
      tmuxSessions,
      memory,
      warnings,
    };
  }

  return { provision, addRepo, startServer, stopServer, restart, statusSnapshot };
}

function summarize(res) {
  // Keep tool output compact: trim noisy stdout/stderr to the tail.
  const tail = (s) => String(s || '').trim().split('\n').slice(-6).join('\n');
  return { ok: res.ok, code: res.code, cmd: res.cmd, dryRun: res.dryRun || false, output: tail(res.stdout) || tail(res.stderr) };
}
