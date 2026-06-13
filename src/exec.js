// Copyright (C) 2026 Gabe Levine
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License, version 3.
//
// This program is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// Affero General Public License for more details.
import { execFile } from 'node:child_process';

// Allowlist of base commands the Conductor is ever permitted to run. We use
// execFile (never a shell), so arguments can't be interpreted as shell syntax —
// the allowlist is a second belt-and-suspenders layer.
const ALLOWED = new Set(['systemctl', 'tmux', 'free', 'bash', 'loginctl']);

// Run a local command safely. Returns { ok, code, stdout, stderr, cmd }.
// Never throws on a non-zero exit — callers decide what a failure means
// (e.g. `systemctl status` exits non-zero for an inactive unit, which is
// information, not an error). DRY_RUN short-circuits with a synthetic result so
// the entire control surface can be exercised without a droplet.
export function makeRunner({ dryRun = false, timeoutMs = 120000, log = () => {} } = {}) {
  return function run(command, args = [], opts = {}) {
    const cmdStr = `${command} ${args.join(' ')}`.trim();
    if (!ALLOWED.has(command)) {
      return Promise.resolve({ ok: false, code: 126, stdout: '', stderr: `command not allowed: ${command}`, cmd: cmdStr });
    }
    if (dryRun) {
      log(`[dry-run] ${cmdStr}`);
      return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '', cmd: cmdStr, dryRun: true });
    }
    return new Promise((resolve) => {
      execFile(command, args, { timeout: opts.timeoutMs ?? timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
        resolve({ ok: code === 0, code, stdout: stdout ?? '', stderr: stderr ?? '', cmd: cmdStr });
      });
    });
  };
}

// A unit/repo name is interpolated into `claude-rc@<name>` and passed to
// systemctl. Restrict it hard so it can't smuggle extra arguments or unit
// syntax. (execFile already prevents shell injection; this prevents *argument*
// and unit-name abuse.)
const NAME_RE = /^[A-Za-z0-9._-]+$/;
export function assertSafeName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`invalid name "${name}": must match ${NAME_RE}`);
  }
  return name;
}
