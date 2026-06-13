// Copyright (C) 2026 Gabe Levine
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License, version 3.
//
// This program is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// Affero General Public License for more details.

// The M1 control surface, expressed as MCP tools. Tools are prefixed
// `conductor_` so they never collide with Chaos Dimension's task tools when a
// client is connected to both servers at once. Each handler returns a plain
// object; the server serializes it to JSON text content.
//
// Deferred to M3 (declarative reconcile): conductor_set_target,
// conductor_spawn_session, conductor_reconcile. They are intentionally absent
// here so the surface honestly reflects what M1 can do.
export function buildTools(runtime) {
  return [
    {
      name: 'conductor_status',
      description:
        'Report the live state of the droplet runtime: claude-rc-server units (per repo: active/sub + session count), tmux sessions, free RAM, and warnings. Read-only.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const snap = await runtime.statusSnapshot();
        snap.generatedAt = new Date().toISOString();
        return snap;
      },
    },
    {
      name: 'conductor_provision',
      description:
        'Provision the box: run claude-rc-server install.sh (deps, systemd user unit, linger) and setup-mcp.sh (Chaos Dimension MCP at user scope). Idempotent. Does NOT run the interactive auth.sh — do that once by hand.',
      inputSchema: {
        type: 'object',
        properties: { with_mcp: { type: 'boolean', description: 'Also run setup-mcp.sh (default true).' } },
        additionalProperties: false,
      },
      handler: ({ with_mcp }) => runtime.provision({ withMcp: with_mcp !== false }),
    },
    {
      name: 'conductor_add_repo',
      description:
        'Clone a repo onto the box and start a Remote Control server for it (wraps add-repo.sh: clone into PROJECTS_DIR + systemctl --user enable --now claude-rc@<name>).',
      inputSchema: {
        type: 'object',
        properties: {
          git_url: { type: 'string', description: 'Repo URL to clone (ssh or https).' },
          name: { type: 'string', description: 'Optional short service/dir name; defaults to the repo basename.' },
        },
        required: ['git_url'],
        additionalProperties: false,
      },
      handler: ({ git_url, name }) => runtime.addRepo({ gitUrl: git_url, name }),
    },
    {
      name: 'conductor_start_server',
      description: 'Start a repo\'s Remote Control server (systemctl --user start claude-rc@<repo>).',
      inputSchema: {
        type: 'object',
        properties: { repo: { type: 'string' } },
        required: ['repo'],
        additionalProperties: false,
      },
      handler: ({ repo }) => runtime.startServer(repo),
    },
    {
      name: 'conductor_stop_server',
      description: 'Stop a repo\'s Remote Control server (systemctl --user stop claude-rc@<repo>). Frees its RAM.',
      inputSchema: {
        type: 'object',
        properties: { repo: { type: 'string' } },
        required: ['repo'],
        additionalProperties: false,
      },
      handler: ({ repo }) => runtime.stopServer(repo),
    },
    {
      name: 'conductor_restart',
      description: 'Restart a repo\'s server, or all of them when no repo is given (systemctl --user restart claude-rc@<repo> | claude-rc@*).',
      inputSchema: {
        type: 'object',
        properties: { repo: { type: 'string', description: 'Omit to restart every claude-rc server.' } },
        additionalProperties: false,
      },
      handler: ({ repo }) => runtime.restart(repo),
    },
  ];
}
