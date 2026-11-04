# Changelog

All notable changes to Prompt Coach. Versions follow `.claude-plugin/plugin.json`.

## 1.3.1 (2026-11-04)

A review round: ten fixes found by an independent code review and by edge-case probes. 24/24 tests pass.

### Fixed

1. **The pane could stay busy forever.** If anything failed mid-rewrite (an engine call, a blocked model, a reload), the pane stayed on "Improving…", with no way out in VS Code. It now always releases, shows the draft back with a note, and a busy state left over from a reload is cleared at session start.
2. **`claude -p` and the SDK dropped weak prompts.** With no surface, the VS Code hold-on-Enter path ran and the turn ended without running anything. Prompts are now held only in VS Code (and mobile), and only from the composer.
3. **Model calls could not be cancelled and two rewrites could overlap.** Cancel now aborts the call, a new rewrite cancels the previous one, the pane shows Cancel while busy, and results are returned per run instead of through shared module variables.
4. **"Improve again" in the terminal lost the original draft** for Undo: it started from the previous proposal. It now starts from the person's draft.
5. **A refused send lost the draft.** If another hook rejected sending the proposal, the composer stayed empty; the original draft now comes back. Cancel after a VS Code hold also restores the draft if the composer was emptied.
6. **"no compila" counted as an unfilled gap** (clarity 0 and −10). The Italian word `compila` was a gap cue; it is gone. This also corrected Opus's benchmark average from 93.8 to **94.8**: one of its proposals said "la app compila" as an acceptance criterion.
7. **Spanish drafts were detected as Portuguese.** `no`, `da` and `na` no longer count as Portuguese stopwords.
8. **False context anchors.** "and/or", "ES/EN", dates such as 04/11/2026 and camelCase brands (JavaScript, iOS, GitHub) scored full context. Paths now need an extension, a prefix, three segments or a typical folder, and brands are excluded.
9. **Smaller rubric misses.** `e.g.`, `p. ej.` and `z. B.` never matched; an attachment chip counted twice as detail; the typographic apostrophe in "don’t" was not recognised.
10. **The terminal band skipped validation.** Its button and the empty pane's button now go through the same checks as VS Code (empty draft, `/command`, 8000-character limit) and never start a second rewrite while one is running.

### Changed

- Keyword stuffing without content ("Constraints: only, never") now scores weak: section headers no longer count as constraints, and a limit word must be followed by what it limits.
- Negative imperatives count as constraints in all six languages ("no modifiques", "ne pas changer", "keine neuen", "não adicione", "non aggiungere"), while bug descriptions ("no funciona") do not.
- The band no longer scores short questions, which the task rubric marked as weak; `/coach` still improves them.

## 1.3.0 (2026-11-04)

### Added

- `model` setting: `haiku` (default), `sonnet` or `opus`.
- `language` setting with six interface languages: `auto`, `en`, `es`, `fr`, `de`, `pt`, `it`. The rubric reads drafts in all six, and the proposal is always written in the draft's language.
- `verbosity` setting: `concise` (about 100 words), `balanced` (about 250) or `detailed` (about 330).
- Benchmark of three models over 16 drafts in six languages, with a blind judge that also checks the proposal's language (16/16 for all three models).

## 1.2.1 (2026-11-04)

### Fixed

- "devuelve" / "returns" alone no longer counts as a response format: it usually describes the bug ("returns 500"). Spanish and English drafts now score the same.

### Added

- English README by default, Spanish README, demos and charts in both languages, a 35-second demo video, plugin icon and social preview image.

## 1.2.0 (2026-11-04)

### Added

- `language` setting (`auto`, `en`, `es`) for the interface.

## 1.1.3 (2026-11-04)

### Changed

- In a short pane the buttons sit above the editor and the missing criteria are shown in compact form.

## 1.1.2 (2026-11-04)

### Fixed

- In a narrow terminal the pane did not appear: it was opened after the command returned. It now opens within the command, and if there is no room `/coach` returns the proposal in the transcript.

## 1.1.1 (2026-11-04)

### Changed

- The band and the pane adapt to the terminal's width and height.

## 1.1.0 (2026-11-04)

### Changed

- Verifiable 100-point rubric with seven criteria; an invented path scores nothing, and the pane says what is missing for 100.
- A targeted second pass when the first rewrite leaves gaps the model can fill without inventing facts.
- Haiku by default after a benchmark against Sonnet.

## 1.0.0 (2026-11-04)

- First version: live score band, `/coach`, proposal pane, terminal and VS Code.
