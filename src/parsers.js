// Copyright (C) 2026 Gabe Levine
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License, version 3.
//
// This program is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// Affero General Public License for more details.

// Pure string -> structured parsers for the command output the Conductor reads.
// Kept free of any I/O so they're trivially unit-testable with fixtures.

// `systemctl --user list-units --all --plain --no-legend 'claude-rc@*'`
// Columns: UNIT LOAD ACTIVE SUB DESCRIPTION (description may contain spaces).
// Returns [{ repo, unit, load, active, sub, description }].
export function parseSystemctlUnits(stdout) {
  const out = [];
  for (const raw of String(stdout).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const [unit, load, active, sub] = parts;
    if (!unit.startsWith('claude-rc@')) continue;
    const description = parts.slice(4).join(' ');
    out.push({ repo: repoFromUnit(unit), unit, load, active, sub, description });
  }
  return out;
}

function repoFromUnit(unit) {
  // claude-rc@putu.service -> putu
  const m = /^claude-rc@(.+?)(?:\.service)?$/.exec(unit);
  return m ? m[1] : unit;
}

// `tmux -L claude-rc list-sessions`
// Lines look like: "claude-putu: 1 windows (created Fri Jun 13 ...) (attached)"
// When no tmux server is running the command errors and prints to stderr; the
// caller passes us whatever stdout there was (often empty) -> [].
export function parseTmuxSessions(stdout) {
  const out = [];
  for (const raw of String(stdout).split('\n')) {
    const line = raw.trim();
    if (!line || !line.includes(':')) continue;
    const name = line.slice(0, line.indexOf(':')).trim();
    if (!name) continue;
    const windowsMatch = /:\s*(\d+)\s+windows?/.exec(line);
    out.push({
      session: name,
      repo: name.startsWith('claude-') ? name.slice('claude-'.length) : name,
      windows: windowsMatch ? Number(windowsMatch[1]) : null,
      attached: /\(attached\)/.test(line),
    });
  }
  return out;
}

// `free -b` — parse the Mem: line into bytes.
// total used free shared buff/cache available
// Returns { totalBytes, usedBytes, freeBytes, availableBytes } or null.
export function parseFree(stdout) {
  for (const raw of String(stdout).split('\n')) {
    const line = raw.trim();
    if (!/^Mem:/i.test(line)) continue;
    const nums = line.replace(/^Mem:\s*/i, '').split(/\s+/).map(Number);
    if (nums.length < 3 || nums.some((n) => Number.isNaN(n))) return null;
    return {
      totalBytes: nums[0],
      usedBytes: nums[1],
      freeBytes: nums[2],
      // `available` is the 6th column on modern `free`; fall back to `free`.
      availableBytes: nums.length >= 6 ? nums[5] : nums[2],
    };
  }
  return null;
}
