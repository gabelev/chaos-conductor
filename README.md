# Chaos Conductor

> A declarative control plane for remote Claude Code sessions. It drives [`claude-rc-server`](https://github.com/gabelev/claude-rc-server) from an MCP tool surface — provision the box, add repos, start/stop/restart per-repo servers, and read live status — **without SSH**. The longer-term goal: let [Chaos Dimension](https://github.com/gabelev/chaos_dimension) declare *what should be running* and have the Conductor reconcile the droplet to match.

**Status:** M1 (imperative wrappers + status read-back). The declarative reconcile loop is M3 — see [Milestones](#milestones) and [`docs/spec.md`](docs/spec.md).

## Why this exists

`claude-rc-server` runs persistent Claude Code Remote Control sessions on a headless box, one server per repo. Today you operate it **by hand over SSH**: run `install.sh`, `auth.sh`, `setup-mcp.sh`, `add-repo.sh`, then babysit it with `systemctl --user …`, `tmux attach`, `free -h`. The human is the orchestrator, and there's no single source of truth for what *should* be running versus what *is*.

Chaos Conductor wraps that whole lifecycle behind a small, callable MCP surface so a Claude Code session (or, later, the board itself) can manage the runtime programmatically.

## Where it fits

```
Intent        Claude + spec files  ─┐
Coordination  Chaos Dimension       ─┤  desired state: which repos want agents, how many
                                     │
              ▼ Chaos Conductor ◄────┘  ← this repo: coordination ↔ execution
Execution     claude-rc-server on a VPS (systemd · tmux · git worktrees · sessions)
Human loop    escalation for auth prompts / OOM / repeated crashes
```

- **Chaos Dimension** is the board (what to work on, and the system of record).
- **claude-rc-server** is the runtime (where agents actually run).
- **Chaos Conductor** is the layer between them: it turns intent into runtime actions. In M1 it's driven interactively via MCP tools; in M3 it reconciles automatically from the board's `remoteRunnable` tasks.

## How it differs from sub-agents

Sub-agents are *within* one Claude Code session — short-lived helpers spawned for a task and reaped when it ends. The Conductor operates one level up: it manages **long-lived, independent Remote Control servers and sessions across repos on a box**, as durable capacity you start, stop, and observe. It manages *capacity*, not *work* — the reasoning and task-claiming still happen inside the sessions (against the Chaos Dimension claim protocol).

## Requirements

- The Conductor runs **on the same box** as `claude-rc-server` (it drives it via local `systemctl --user` / scripts / `tmux`).
- Node.js 18+.
- A working `claude-rc-server` checkout (default `~/claude-rc-server`; override with `CLAUDE_RC_ROOT`).

## Install

```bash
git clone https://github.com/gabelev/chaos-conductor ~/chaos-conductor
cd ~/chaos-conductor
npm install
cp .env.example .env   # optional; sane defaults otherwise
```

## Connect it to Claude Code (MCP, stdio)

```bash
claude mcp add --scope user --transport stdio chaos-conductor \
  -- node /home/youruser/chaos-conductor/bin/chaos-conductor.js mcp
```

Restart Claude Code, run `/mcp`, and you should see `chaos-conductor` with its tools.

## The M1 control surface

All tools are prefixed `conductor_` so they don't collide with Chaos Dimension's task tools when both servers are connected.

| Tool | What it does |
|---|---|
| `conductor_status` | Live snapshot: `claude-rc@*` units (per repo: active/sub + session count), tmux sessions, free RAM, warnings. Read-only. |
| `conductor_provision` | Run `install.sh` (+ `setup-mcp.sh`). Idempotent. (Interactive `auth.sh` is **not** automated — run it once by hand.) |
| `conductor_add_repo` | `add-repo.sh <git_url> [name]` — clone + enable a per-repo server. |
| `conductor_start_server` / `conductor_stop_server` | `systemctl --user start\|stop claude-rc@<repo>`. |
| `conductor_restart` | Restart one repo's server, or all of them (`claude-rc@*`) when no repo is given. |

### Quick check without an MCP client

```bash
# print a one-shot status snapshot
node bin/chaos-conductor.js status

# exercise the whole code path off a droplet (logs intended commands, runs nothing)
CONDUCTOR_DRY_RUN=1 node bin/chaos-conductor.js status
```

## Configuration

Environment only (so it runs cleanly as a systemd user unit). See [`.env.example`](.env.example): `CLAUDE_RC_ROOT`, `PROJECTS_DIR`, `CLAUDE_RC_TMUX_SOCKET`, `CONDUCTOR_DRY_RUN`, `CONDUCTOR_EXEC_TIMEOUT_MS`, `CONDUCTOR_ASSUME_TOKEN`.

## Safety

The Conductor only ever runs an allowlisted set of base commands (`systemctl`, `tmux`, `free`, `bash` for the runtime's own scripts) via `execFile` — **never a shell** — and validates any repo/unit name against `^[A-Za-z0-9._-]+$` before it reaches a `claude-rc@<name>` invocation, so a name can't smuggle extra arguments. It clones repos and runs systemd user units, so scope which callers may invoke `conductor_add_repo` / `conductor_provision` accordingly.

## Milestones

- [x] **M1 — Imperative wrappers + status read-back.** MCP tools over the existing scripts; typed status snapshot. Proves remote control without SSH.
- [ ] **M3 — Reconcile loop.** Desired state from Chaos Dimension `remoteRunnable` tasks; diff/converge on a timer; `conductor_set_target` / `conductor_reconcile`. (Session spawning depends on the Remote Control session API; see spec.)
- [ ] **M4 — Self-heal + escalation.** Ghost-session reaping, crash backoff, RAM-ceiling guardrails, Telegram escalation for auth expiry / OOM / repeated crashes.

Full design: [`docs/spec.md`](docs/spec.md).

## Development

```bash
npm test          # vitest: pure parsers + runtime (stubbed exec). No droplet needed.
npm run test:watch
```

## License

[AGPL-3.0-only](LICENSE) — same as the rest of the ecosystem.
