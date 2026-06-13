// Copyright (C) 2026 Gabe Levine
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License, version 3.
//
// This program is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// Affero General Public License for more details.
import { homedir } from 'node:os';
import { join } from 'node:path';

// All configuration is environment-driven so the Conductor can run as a thin
// systemd user unit on the droplet with no config file of its own.
//
//   CLAUDE_RC_ROOT   path to the claude-rc-server checkout (its scripts/ dir is
//                    what we shell out to). Default ~/claude-rc-server.
//   PROJECTS_DIR     where repos are cloned (mirrors claude-rc-server's own
//                    default). Default ~/projects.
//   CONDUCTOR_DRY_RUN  when truthy, exec logs intended commands instead of
//                    running them — lets the whole surface be exercised off a
//                    droplet (tests, local sanity checks).
//   CONDUCTOR_EXEC_TIMEOUT_MS  per-command timeout (default 120000).
export function getConfig(env = process.env) {
  const home = homedir();
  return {
    claudeRcRoot: env.CLAUDE_RC_ROOT || join(home, 'claude-rc-server'),
    projectsDir: env.PROJECTS_DIR || join(home, 'projects'),
    dryRun: isTruthy(env.CONDUCTOR_DRY_RUN),
    execTimeoutMs: Number(env.CONDUCTOR_EXEC_TIMEOUT_MS) || 120000,
    // The tmux server socket claude-rc-server pins (-L claude-rc). Kept in sync
    // with the runtime's systemd unit + bin/claude-rc.sh.
    tmuxSocket: env.CLAUDE_RC_TMUX_SOCKET || 'claude-rc',
    // Whether claude-rc-server's config has a Chaos Dimension MCP token set —
    // surfaced as a status warning, not read here (it lives in the runtime's
    // env file). Set CONDUCTOR_ASSUME_TOKEN=1 to silence the warning.
    assumeChaosToken: isTruthy(env.CONDUCTOR_ASSUME_TOKEN),
  };
}

function isTruthy(v) {
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
