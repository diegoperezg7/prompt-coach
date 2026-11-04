---
name: coach
description: >
  Prompt Coach: rewrite the user's prompt draft so a coding agent gets it right first time, scored with a
  100-point rubric. Use when the user says "$coach", "coach this prompt", "improve my prompt", or after the
  Prompt Coach hook held a weak prompt.
---

# Prompt Coach

The draft is the text after `$coach`. If there is none, it is the user's last prompt that the Prompt Coach
hook held.

1. Score the draft by passing it on stdin, so its line breaks stay real line breaks:
   ```
   @PROMPT_COACH_CLI@ score <<'DRAFT'
   <draft>
   DRAFT
   ```
   It prints the score and the criteria missing for 100.
2. Rewrite it. Keep the intent and add no requirement that cannot be inferred from it. Write in the draft's
   language, with these sections, each header on its own line: Goal, Context, Detail, Acceptance criteria,
   Constraints, Response format (translated into the draft's language). Short bullets, at most 220 words.
   - Goal: what to achieve, with an action verb and an object.
   - Context: where to act: path, file, `symbol` or @mention. Only facts from the draft or this conversation:
     never invent paths or names. If one is missing, say the agent must locate it first.
   - Detail: current and expected behaviour, literal error, example or figure, taken from the draft.
   - Acceptance criteria: how to check it is done: a test, a command or a concrete case.
   - Constraints: at least two: what not to touch, scope, dependencies.
   - Response format: what the agent must return when it finishes.
   - No vague references ("this", "stuff") and no bracketed gaps.
3. Score your rewrite the same way, on stdin. If a criterion other than context or detail is still missing,
   fix that one and score again, once.
4. Show the user the proposal, its score before and after, and what is still missing for 100 (usually a fact
   only they know, such as the file). Do not send or run anything: the user decides.
