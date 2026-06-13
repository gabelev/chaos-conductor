# Chaos Conductor — High-Level Spec

> Mirrored from the Chaos Dimension task `wwkwrbrd8eh5cbc3ladthohm`. This is the
> design of record; the code in this repo implements it milestone by milestone.

**Status:** Draft / in progress (M1 implemented) · **Depends on:** `claude-rc-server` (runtime), Chaos Dimension MCP (coordination)

## Summary
A control-loop service that turns Chaos Dimension from a board the droplet's agents passively *report to* into an active **control plane** that provisions and manages the runtime itself. It automates everything done by hand in `claude-rc-server` — install, auth, MCP registration, repo cloning, per-repo Remote Control servers, and session spawn/reap — and drives it **declaratively from the board** instead of imperatively over SSH.

One line: *the board declares what should be running; the conductor reconciles the droplet to match.*

## Problem
`claude-rc-server` today is imperative shell scripts run by a human over SSH. To get an agent working you must, on the box, in order: `install.sh` → `auth.sh` → `setup-mcp.sh` → `add-repo.sh <git-url> [name]`, then manage by hand with `systemctl --user stop/start/restart`, `tmux attach`, `status`, `free -h`, reaping ghost sessions. **The human is the orchestrator.** There's no programmatic way to say "this workstream needs three sessions," and no single source of truth for what *should* run vs. what *is*.

## Goals
- Spawn, route, tear down Remote Control sessions programmatically — no SSH.
- Make the board the **desired-state declaration**: `remoteRunnable` tasks express intent; the conductor makes the droplet match.
- Wrap the full `claude-rc-server` lifecycle behind a small callable surface.
- Enforce capacity + resource limits (per-repo `CAPACITY`, box-wide RAM headroom).
- Self-heal: detect crashed servers, reap ghost/timed-out sessions, reconcile drift.
- Report live runtime state back to the Agent Monitor.

## Non-goals (v1)
- Replacing systemd/tmux/`claude-rc.sh` — the conductor *drives* them, doesn't reimplement.
- Multi-box / cluster scheduling (single droplet for v1).
- Building agent reasoning / work-stealing (lives in sessions + the CD claim protocol). The conductor manages *capacity*, not *work*.
- Fully automating interactive OAuth (see Open Questions).

## Where it fits (four-plane model)
```
Intent        Claude + spec files  ─┐
Coordination  Chaos Dimension       ─┤  desired state: which workstreams/repos
                                     │                 want agents, how many
              ▼ Chaos Conductor ◄────┘  ← reconciler, coordination ↔ execution
Execution     claude-rc-server on VPS (systemd · tmux · worktrees · sessions)
Human loop    Telegram escalation (auth prompts, OOM, repeated crash)
```
The conductor replaces "a person typing `systemctl`." It consumes the `remoteRunnable` / `agentDispatchable` flags the CD task schema already exposes and turns them into runtime actions.

## Architecture: declarative reconcile loop
Kubernetes-style, not a pile of RPCs:
- **Desired state** from the board: per workstream/repo, a target live-session count derived from `remoteRunnable` tasks.
- **Actual state** from the box: active `claude-rc@*` units, sessions per server, free RAM.
- **Reconcile()** diffs the two and emits the minimal actions (clone, enable unit, start/stop server, request session, reap ghost), then writes observed state back to CD.

One source of truth; a crash just re-converges on the next tick.

## Control surface (MCP tools)
- `conductor_provision()` — baseline box (deps, unit, linger, MCP).
- `conductor_add_repo(git_url, name?)` — clone + enable a server.
- `conductor_start_server(repo)` / `conductor_stop_server(repo)` / `conductor_restart(repo?)`.
- `conductor_status()` — units, sessions, RAM, warnings, auth/token health.
- *(M3)* `conductor_set_target(workstream|repo, n)` — declare desired session count.
- *(M3)* `conductor_spawn_session(repo)`, `conductor_reconcile()` — force a tick (also on a timer).

## Milestones
1. **M1 — Imperative wrappers + status read-back.** MCP tools shelling out to the existing scripts (provision, add_repo, start/stop/restart, status). No loop; proves remote control without SSH. **← this repo, now.**
2. **M2 — State read-back.** Parse `systemctl` + session list + `free` into a typed snapshot; surface on the Agent Monitor. (Folded into M1's `conductor_status`.)
3. **M3 — Reconcile loop.** Desired state from `remoteRunnable` tasks; diff/converge on a timer; idempotent actions.
4. **M4 — Self-heal + escalation.** Ghost reaping, crash backoff, RAM guardrails, Telegram escalation for auth expiry / OOM / repeated crash.

## Open questions / risks
- **Headless OAuth.** Interactive paste-code / port-forward can't be fully automated. v1 keeps auth manual but adds token-health detection + a prompt on re-auth, vs. silent failure.
- **Capacity vs. RAM.** Servers × sessions × subagents OOM a small droplet. Reconcile must treat free RAM as a hard ceiling and refuse spawns, not just honor `CAPACITY`.
- **Ghost sessions.** Reboots mint new sessions; old ones linger "connected" until timeout. Need a reap policy that won't kill live work.
- **MCP read-back bug.** Known `claude mcp add --scope user` vs `claude mcp list` mismatch; verify the `~/.claude.json` block directly (as `setup-mcp.sh` does).
- **Privilege surface.** The conductor can clone arbitrary repos + run systemd units; scope what callers (esp. agents) may request.
- **Single point of failure.** If the conductor dies, the box keeps running (systemd) but loses convergence. Make it a thin, restartable systemd unit too.
