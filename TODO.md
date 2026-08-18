# Goldfish -- Backlog

## Immediate Fixes
- [x] Fix version and skill inventory drift across docs and manifests
- [x] Align brief save behavior with activation guidance
- [x] Make registry writes atomic
- [x] Tighten malformed checkpoint parsing
- [x] Validate `from` and `to` inputs strictly
- [x] Add regression coverage for the above, including unborn-`HEAD` git state

## From Real Usage
- [ ] Tune skill language based on session observations
- [ ] Evaluate checkpoint frequency in practice (too many? too few?)
- [x] Windows / MCP JSON: checkpoint `description` payloads fail before Goldfish runs — fixed: `description_file` parameter + skill/tool guidance (see CHANGELOG Unreleased)
  - Report: Claude Code + Goldfish plugin on Windows (`C:/Users/keaedwar/source/repos/ResearchFunding`).
  - Symptom: `mcp_plugin_goldfish_goldfish_checkpoint` → `InputValidationError: ... input that could not be parsed as JSON` (unescaped backslashes, unescaped control characters, or truncated output). Brief save succeeded. Three ~4KB markdown checkpoint attempts failed; a shorter fourth succeeded (`checkpoint_088f7198`).
  - Goldfish never saw the failed calls — the host rejected the tool args.
  - Related agent mistake (not Goldfish): wrote `/tmp/brief_body.md` then `head`/`python` couldn't find it. Git Bash `/tmp` ≠ native Windows Python / `%TEMP%`.
  - Likely cause: large `description` with real newlines or unescaped `\` from `C:\Users\...` in MCP JSON. Skill currently tells agents to embed `\n` + markdown in the arg.
  - Candidate fix: add `description_file` (workspace-relative path) so big writeups skip MCP JSON; also tell skills to use `/` in Windows paths and keep inline descriptions short.

## Potential Future Features (Evidence Required)
- [ ] Checkpoint pruning/archival (if `.memories/` size becomes a real burden)
- [ ] Brief templates (if pattern emerges from usage)
- [ ] Checkpoint export/reporting beyond the standup format

## Open Questions
- Should skills be more or less prescriptive?
- Where does BM25 search fall short, if anywhere?

## Low Priority (No Evidence of Impact)
- [ ] Checkpoint handler: optional metadata aliases (`next` vs `next_steps`, `symbols` vs `affected_symbols`)
