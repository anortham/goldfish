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

## Potential Future Features (Evidence Required)
- [ ] Checkpoint pruning/archival (if `.memories/` size becomes a real burden)
- [ ] Brief templates (if pattern emerges from usage)
- [ ] Checkpoint export/reporting beyond the standup format

## Open Questions
- Should skills be more or less prescriptive?
- Where does BM25 search fall short, if anywhere?

## Low Priority (No Evidence of Impact)
- [ ] Checkpoint handler: optional metadata aliases (`next` vs `next_steps`, `symbols` vs `affected_symbols`)
