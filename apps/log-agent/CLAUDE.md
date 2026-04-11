# apps/log-agent

Lightweight log forwarding agent. Tails systemd journals and streams structured
log lines to the control plane over WebSocket.

## Stack
- Plain Node.js + ws + zod only — no framework
- Types from @ninja/types only — never import from apps/control-plane

## Key rules
- Never throw unhandled errors — the agent must stay alive
- Cursor file at /opt/ninja-log-agent/cursor must be updated after every persisted line
- journalctl is the only log source — no file tailing, no polling
- The deploy-agent and log-agent are independent services — no shared state

## Commits
Conventional commits, scope log-agent.
