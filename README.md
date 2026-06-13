# Chaos Conductor

Declarative control plane for remote Claude Code sessions.

> The board declares what should be running. The Conductor reconciles the droplet to match.

Chaos Conductor turns Chaos Dimension from a board that your agents passively report to into an active control plane that provisions and runs the agents themselves. It automates everything you currently do by hand in [`claude-rc-server`](https://github.com/gabelev/claude-rc-server): installing the runtime, authenticating, registering MCP, cloning repos, standing up per-repo Remote Control servers, and spawning or reaping sessions. Instead of SSHing into a box and typing `systemctl`, you declare intent on the board and the Conductor makes the machine match it.

**Status:** **M1 (imperative wrappers + status read-back) is implemented** — see [Install](#install) and [Control surface](#control-surface). It proves remote control without SSH. The declarative reconcile loop (set targets, converge on a timer) is **M3 and not built yet**. See [Roadmap](#roadmap).

## Why this exists

Running always-on Claude Code agents on a VPS works, but the operations are all manual. With `claude-rc-server` today, getting an agent working means doing this on the box, in order:

1. `install.sh` to set up dependencies, the systemd template unit, and linger.
2. `auth.sh` for a one-time headless OAuth login.
3. `setup-mcp.sh` to register the Chaos Dimension MCP at user scope.
4. `add-repo.sh <git-url>` to clone a repo and enable its server.
5. Hand-driven `systemctl --user` start, stop, and restart, plus `tmux attach`, `free -h`, and periodic cleanup of ghost sessions left behind after reboots.

The human is the conductor. Every "spin up an agent on repo X" is an SSH session. Two things are missing. There is no programmatic way to say "this workstream needs three sessions" and have it happen, and there is no single source of truth for what should be running versus what actually is.

Once you are running several repos, with agents meant to stay alive for days, against a board that already knows what work exists, hand-driving the box stops scaling. The board should drive the box.

## What it is

Chaos Conductor is a control-loop service that runs on the VPS next to `claude-rc-server`. It is a reconciler, modeled on the way Kubernetes thinks about state rather than on one-off commands:

- **Desired state** comes from the board: for each workstream or repo, a target number of live sessions, derived from tasks flagged `remoteRunnable`.
- **Actual state** comes from the box: which `claude-rc@*` units are active, how many sessions each is holding, how much RAM is free.
- **Reconcile** diffs the two and emits the smallest set of actions to close the gap: clone a repo, enable a unit, start or stop a server, request a session, reap a ghost. Then it writes observed state back to the board.

Because every action is idempotent and the loop runs on a timer, a crash is not a crisis. The next tick re-converges. You get one source of truth and a system that heals toward it.

You drive it through MCP tools, so it works the same from the web app, your phone, or another agent. (M1 ships the imperative tools; the timer-driven loop is M3.)

## How it differs from sub-agents

Claude's sub-agents and the Conductor both fan work out across multiple agents, so it is fair to ask whether this just rebuilds them. It does not. They operate at different layers and compose cleanly.

Sub-agents are an in-context, ephemeral, single-machine primitive. A parent agent spawns children that share its turn and its filesystem, run to completion, and return their results into the parent's context. The parent is the coordinator and holds the plan. When the turn ends, the children are gone.

The Conductor is an out-of-context, durable, multi-session, infrastructure-level system. It manages long-lived sessions that survive reboots and keep working while your laptop is closed. Coordination does not live in any agent's context. It lives in an external ledger, the board. There is no central reasoner, and there is a human escalation path that spans real time rather than a single turn.

The shared idea, fanning work out in parallel, is maybe a third of the concept. The harder two-thirds is exactly what sub-agents leave out by design because they are scoped to one session: persistence, reboot survival, OS-level process lifecycle on a remote machine, capacity and memory management, and coordination through a shared substrate.

They stack. A session the Conductor keeps alive can itself fan out to sub-agents for its own subtasks. The Conductor manages the fleet. Sub-agents parallelize within a session.

## Where it fits

### With Chaos Dimension and claude-rc-server

The Conductor is one plane in a four-plane setup:

```
Intent        Claude plus spec files
Coordination  Chaos Dimension              what work exists, what should run
Control       Chaos Conductor   <- new     reconciles desired state onto the box
Execution     claude-rc-server on the VPS  systemd, tmux, worktrees, sessions
Human loop    Telegram escalation          auth prompts, OOM, repeated crashes
```

**Against `claude-rc-server`,** the relationship is a kubelet and control-plane split. `claude-rc-server` is the worker: one server per repo, anchored to a directory, serving sessions up to a capacity. The Conductor is the controller: one per box, driving many servers. The Conductor depends on the worker's control interface, meaning its scripts, the `claude-rc@*` unit-naming convention, and its status output. If the Conductor dies, systemd keeps the servers running. The box loses convergence, not its work.

**Against Chaos Dimension,** the board is the system of record. It declares desired state through the `remoteRunnable` and `agentDispatchable` flags it already exposes. The Conductor reads that intent and writes observed runtime state back to the Agent Monitor. Two invariants keep the separation clean: the board never SSHes into the box, and the Conductor never decides what work to do. One holds intent, the other actuates it.

### In the broader ecosystem

A useful way to place the Conductor is by layer. Agent tooling in 2026 tends to separate into a runtime that executes work, an ops layer that keeps the runtime alive, a memory layer that holds what an agent knows, and a coordination layer that records what work exists. The fast-growing "Claw" ecosystem makes these layers concrete:

- **Runtime.** [OpenClaw](https://github.com/openclaw) is a self-hosted, model-agnostic agent runtime that connects an LLM to messaging platforms with skills and persistent memory. [Claude Code](https://www.claude.com/claude-code) is Anthropic's terminal-native coding agent, with its own sub-agents and Agent Teams. `claude-rc-server` is the thin layer that runs Claude Code as an always-on remote service.
- **Ops and keep-alive.** [AlphaClaw](https://github.com/chrysb/alphaclaw) wraps OpenClaw with a self-healing watchdog, git-backed backups, and a browser dashboard, so agents deploy in minutes and stay running for months with no SSH.
- **Memory.** [GBrain](https://github.com/garrytan/gbrain) is a self-wiring knowledge layer, a hybrid search and knowledge graph behind an MCP server, that gives any agent durable memory across sessions.
- **Coordination.** Chaos Dimension is an MCP-native, neutral ledger of what work exists, independent of any runtime.

Chaos Conductor adds the **control plane** for the Claude Code runtime. Its closest analog in the Claw stack is AlphaClaw. Both eliminate SSH, both run a self-healing watchdog, and both keep a fleet of agents alive without babysitting. The Conductor differs in two ways. It targets the Claude Code runtime through `claude-rc-server` rather than OpenClaw. And it is driven declaratively by an external, neutral coordination ledger rather than by its own dashboard. AlphaClaw's source of truth is its control panel. The Conductor's source of truth is the board, which also holds the work itself.

That difference is the whole bet. You own the coordination layer (Chaos Dimension) and the control plane (the Conductor). You rent the runtime, the ops conveniences, and the memory around them. The plan lives in a substrate you control, not inside a single harness or a single vendor's dashboard.

## Install

The Conductor runs **on the same box** as `claude-rc-server` and drives it via local `systemctl --user` / scripts / `tmux`. Requires Node.js 18+ and a `claude-rc-server` checkout (default `~/claude-rc-server`; override with `CLAUDE_RC_ROOT`).

```bash
git clone https://github.com/gabelev/chaos-conductor ~/chaos-conductor
cd ~/chaos-conductor
npm install
cp .env.example .env   # optional; sane defaults otherwise
```

Connect it to Claude Code over MCP (stdio):

```bash
claude mcp add --scope user --transport stdio chaos-conductor \
  -- node /home/youruser/chaos-conductor/bin/chaos-conductor.js mcp
```

Restart Claude Code, run `/mcp`, and you should see `chaos-conductor`.

## Control surface

Driven through MCP tools, callable from the web app, your phone, or another agent. Tools are prefixed `conductor_` so they don't collide with Chaos Dimension's task tools when both servers are connected.

**Available now (M1):**

- `conductor_status` reports `claude-rc@*` units, sessions per server, free RAM, and warnings (auth/token health). Read-only.
- `conductor_provision` brings the box to baseline: dependencies, the systemd unit, linger, and the MCP registration. (The interactive `auth.sh` step stays manual.)
- `conductor_add_repo(git_url, name?)` clones a repo and enables its server.
- `conductor_start_server(repo)`, `conductor_stop_server(repo)`, and `conductor_restart(repo?)` handle one-off lifecycle actions (restart all when no repo is given).

**Planned (M3, the declarative loop):**

- `conductor_set_target(workstream_or_repo, n)` declares the desired live-session count.
- `conductor_spawn_session(repo)` requests a new session (depends on the Remote Control session API).
- `conductor_reconcile()` forces a tick. The loop also runs on a timer.

### Without an MCP client

```bash
node bin/chaos-conductor.js status                  # one-shot snapshot
CONDUCTOR_DRY_RUN=1 node bin/chaos-conductor.js status   # log intended commands, run nothing (works off a droplet)
```

## Configuration

Environment only, so it runs cleanly as a systemd user unit. See [`.env.example`](.env.example): `CLAUDE_RC_ROOT`, `PROJECTS_DIR`, `CLAUDE_RC_TMUX_SOCKET`, `CONDUCTOR_DRY_RUN`, `CONDUCTOR_EXEC_TIMEOUT_MS`, `CONDUCTOR_ASSUME_TOKEN`.

## Safety

The Conductor only ever runs an allowlisted set of base commands (`systemctl`, `tmux`, `free`, `bash` for the runtime's own scripts) via `execFile` — **never a shell** — and validates any repo/unit name against `^[A-Za-z0-9._-]+$` before it reaches a `claude-rc@<name>` invocation, so a name can't smuggle extra arguments.

## Scope and caveats

This is a v1 design with deliberate limits:

- **Single box.** No multi-host or cluster scheduling yet.
- **Auth stays manual.** The interactive OAuth step in `auth.sh` cannot be fully automated. The Conductor detects token health and (in M4) escalates over Telegram when a re-auth is needed, rather than failing silently.
- **RAM is a hard ceiling.** Servers times sessions times sub-agents will OOM a small droplet. Reconcile (M3) refuses to spawn past the memory headroom, independent of per-repo capacity.
- **Privilege surface.** The Conductor can clone repos and run systemd units. Scope what callers may request, especially when the caller is an agent.

## Roadmap

1. [x] **M1, imperative wrappers.** MCP tools that shell out to the existing scripts. No loop yet. Proves remote control without SSH.
2. [x] **M2, state read-back.** Parse `systemctl`, the session list, and `free` into a typed snapshot. (Folded into `conductor_status`; Agent Monitor surfacing still to come.)
3. [ ] **M3, reconcile loop.** Desired state from `remoteRunnable` tasks, converging on a timer with idempotent actions.
4. [ ] **M4, self-heal and escalation.** Ghost reaping, crash backoff, RAM guardrails, and Telegram escalation for auth expiry, OOM, and repeated crashes.

## Development

```bash
npm test          # vitest: pure parsers + runtime (stubbed exec). No droplet needed.
npm run test:watch
```

Design of record: [`docs/spec.md`](docs/spec.md).

## Related

- **Chaos Dimension** — the coordination layer and board: <https://github.com/gabelev/chaos_dimension>
- **`claude-rc-server`** — the per-repo Claude Code runtime the Conductor drives: <https://github.com/gabelev/claude-rc-server>

## License

[AGPL-3.0-only](LICENSE) — same as the rest of the ecosystem.

---

*Ecosystem descriptions and links (OpenClaw, AlphaClaw, GBrain) are from the project's positioning notes and accurate as of mid-2026. The Claw ecosystem moves fast — verify them before any public release.*
