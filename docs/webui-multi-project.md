# WebUI Multi-Project Discovery

Evolver WebUI can discover local projects that were used by OpenClaw, Cursor,
Claude Code, or Codex, then switch the dashboard to that project's own
`memory/`, `memory/evolution/`, `assets/gep/`, and `logs/` files.

Default discovery is limited to known local agent metadata directories:

- `~/.openclaw/agents/*/sessions/*.jsonl`
- `~/.claude/projects/*/*.jsonl`
- `~/.cursor/projects/*/terminals/*.txt`
- `~/.codex/sessions/*.jsonl`

For custom agent locations, set explicit project roots:

```bash
export EVOLVER_WEBUI_EXTRA_PROJECTS=/path/to/project-a:/path/to/project-b
```

On Windows, use `;` instead of `:`. Discovery only returns metadata to the
browser; transcript contents are not exposed through `GET /webui/projects`.
