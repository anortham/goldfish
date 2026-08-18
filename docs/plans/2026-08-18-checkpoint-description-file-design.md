# Checkpoint `description_file` — design

**Date:** 2026-08-18
**Problem:** On Windows, Claude Code rejected ~4KB inline checkpoint descriptions with `InputValidationError` before Goldfish ran. The model breaks the tool-call JSON on long multi-line text and `\` path characters. Verified 2026-08-18: the parse errors reproduce, Goldfish itself accepts the same payload when the JSON is valid, and the error string does not exist in Goldfish or the MCP SDK. Known Claude Code issues #5504 and #14442 match.

**Fix:** Let large writeups skip the tool-call JSON. Add a `description_file` parameter, and teach the skill to keep inline descriptions short.

## Architecture

No Architecture Impact — one new optional parameter on an existing tool handler, plus documentation text.

## Behavior

- `checkpoint` accepts either `description` (inline) or `description_file` (path to a UTF-8 markdown file). The file content becomes the checkpoint description.
- Exactly one of the two must be present. Both → error. Neither → error.
- A relative `description_file` path resolves against the workspace. Backslash separators in a relative path are normalized to `/` so Windows-style paths work. An absolute path is used as-is.
- A missing or unreadable file → a clear error that names the resolved path.
- A file that is empty or whitespace-only → error.
- Goldfish never deletes the file. The skill tells the agent to delete its draft after the save succeeds.
- Everything downstream (save, git capture, response format) is unchanged.

## Files

- `src/types.ts` — `CheckpointArgs`: `description` becomes optional, add `description_file?: string`.
- `src/handlers/checkpoint.ts` — resolve workspace, then apply the rules above before `saveCheckpoint`.
- `src/tools.ts` — add the `description_file` schema property, drop `description` from `required`, add one short line to the tool description (stay under the 2,000 character cap).
- `skills/checkpoint/SKILL.md` — new section: keep inline descriptions under ~2KB, use `/` in paths, use `description_file` for long bodies, draft under `.memories/` (excluded from git-file capture), delete the draft after the save.
- `.agents/skills/checkpoint/SKILL.md` + `docs/agent-instructions/goldfish-usage.md` — regenerate with `bun run sync:agent-skills`.
- `src/hook-context.ts` — add `description_file` to the quick-reference line.
- `TODO.md` — mark the report item done. `CHANGELOG.md` — add an entry.

## Acceptance criteria

- [ ] Saves a checkpoint from a workspace-relative `description_file`
- [ ] Accepts an absolute `description_file` path
- [ ] Normalizes backslash separators in a relative path
- [ ] Errors when both `description` and `description_file` are given
- [ ] Errors when neither is given
- [ ] Errors with the resolved path when the file is missing
- [ ] Errors when the file is empty or whitespace-only
- [ ] Leaves the source file in place after the save
- [ ] Tool schema lists `description_file`; `description` is no longer schema-required
- [ ] Tool description stays ≤ 2,000 characters
- [ ] Skill mirror and usage doc stay in sync (`bun test agent-assets`)
- [ ] Full suite green
