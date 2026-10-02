---
name: report-issue
description: Files a GitHub issue against Goldfish with a diagnostic report (versions, client, recent server errors) after the user approves the exact text. Use when the user runs /report-issue, says Goldfish misbehaved, or asks to file a bug against Goldfish.
argument-hint: "[what went wrong]"
---

# Report a Goldfish Issue

File a GitHub issue against `anortham/goldfish`. Never send the report anywhere else. Nothing leaves the machine before the user approves the exact text in step 6.

## Workspace binding

For user-level MCP registrations, pass workspace as the conversation's host-native absolute project root on every checkpoint, brief, and current-project recall call. In a git worktree, pass the worktree path, not the main checkout. Change it when you enter or leave a worktree. Omission and "current" work only with fixed absolute GOLDFISH_WORKSPACE or supported legacy Roots. recall({ workspace: "all" }) is explicit cross-project search, never a fallback; it is invalid for checkpoint and brief. Cwd, registry, and parent-walk candidates are suggestions only. If unbound, retry with {"workspace":"<absolute-project-root>"}.

## Steps

1. Ask the user one question with three parts: what went wrong, what they expected, and the exact tool call or skill with its output. Skip the parts they already gave. Keep the title under 80 characters.
2. If the output says the workspace is unbound or not absolute, retry the call once with the absolute project root. That is a setup error, not a bug. File it only if the retry also fails or the user still wants to.
3. Collect the facts in the terminal:

```
logs="${GOLDFISH_HOME:-$HOME/.goldfish}/logs"
grep -h 'server.start' "$logs"/goldfish-*.log | sort | tail -1
grep -h '\[ERROR\]\|\[WARN\]' "$logs"/goldfish-*.log | sort | tail -10 | sed "s|$HOME|~|g"
uname -sr; bun --version
```

   - The Goldfish version is the `version=` value in the last `server.start` line. If no log exists, use the `version` in the `package.json` two folders above this skill.
   - Add the client and its version (for example `claude --version` or `codex --version`), and the install type: plugin or manual MCP registration.
   - Do not add checkpoint or brief text unless the user asks. It is project memory and is often private.
4. Write the body to `<scratch>/goldfish-issue.md`. That file is the only text that gets submitted:

```
### Environment
- **OS:**
- **Bun:**
- **Goldfish version:**
- **Client:**
- **Install:**

### Description
What happened, and what you expected.

### Reproduction
The exact tool call or skill, and its output.

### Recent server errors
The log lines, or "none".
```

5. Mask home directories as `~` in the whole body. Nothing else is masked: tokens, hostnames, project names, or paths outside the home directory stay as they are.
6. Show the user the whole file, including the log lines. Ask what must be removed. Wait for the answer. Edit the file, then show it again until the user says it is approved. Do not shorten this step.
7. Submit the approved file:
   - If `gh auth status` succeeds, run
     `gh issue create --repo anortham/goldfish --title "<title>" --body-file <scratch>/goldfish-issue.md`
     and give the user the issue link.
   - Otherwise give the user the title, the path of the approved file, and `https://github.com/anortham/goldfish/issues/new`. Tell them to paste the file as the body.

## It's working if

- The submitted body is the approved file, byte for byte.
- The issue body starts with `### Environment` and names the Goldfish version.
- No absolute home path, token, private hostname, or unapproved checkpoint text appears in the body.
- The user has one link: the created issue or the new-issue page to paste into.
