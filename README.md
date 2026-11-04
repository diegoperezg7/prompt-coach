<p align="right"><b>English</b> · <a href="README.es.md">Español</a></p>

<p align="center">
  <img src="assets/banner.svg" alt="Prompt Coach: scores your prompt as you type and rewrites it before you send it" width="100%">
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.2.1-7C3AED?style=flat-square">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-mod-7C3AED?style=flat-square">
  <img alt="Tests" src="https://img.shields.io/badge/tests-16%20passing-15803d?style=flat-square">
  <img alt="Model" src="https://img.shields.io/badge/model-Haiku-5b5b6b?style=flat-square">
  <img alt="Languages" src="https://img.shields.io/badge/UI-EN%20%C2%B7%20ES-5b5b6b?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-5b5b6b?style=flat-square">
</p>

<p align="center">
  A <b>Claude Code mod</b> that scores your prompt draft against a real rubric and rewrites it with Haiku before you send it.<br>
  It never sends anything on its own: you always choose.
</p>

---

## Your score, as you type

A band above the composer scores every keystroke: amber below 60, green from there on. Here it climbs from **5** to **75** as the draft gains a file path, the expected behaviour, a test and a constraint.

<p align="center"><img src="assets/live.gif" alt="The score climbs from 5 to 75 while the prompt is typed" width="100%"></p>

## Improve it with one command

`/coach` (or the band's button) rewrites the draft with Haiku, using the recent conversation, and opens a pane with the proposal. From there you can replace the draft, undo, improve again, copy or cancel. Real recording: **48 → 100**.

<p align="center"><img src="assets/coach.gif" alt="The coach command opens the pane with a 48 to 100 proposal and replaces the draft" width="100%"></p>

## How it works

<p align="center"><img src="assets/flow.svg" alt="Flow: draft, live rubric, Haiku rewrites, a second pass when needed, pane, you choose" width="88%"></p>

## An honest score

<p align="center"><img src="assets/rubric.svg" alt="100-point rubric: goal 20, acceptance 20, context 15, detail 15, constraints 15, format 10, clarity 5" width="88%"></p>

| Criterion | Points | Counts when |
|---|---|---|
| Goal | 20 | there is something to achieve, with a verb and an object |
| Context | 15 | there is a path, file, `symbol` or @mention **that appears in the draft or the conversation** |
| Detail | 15 | two concrete facts: current and expected behaviour, error, example, figure, attachment |
| Acceptance criteria | 20 | it says when it is done (12 if it only asks to verify) |
| Constraints | 15 | two limits: what not to touch, scope |
| Response format | 10 | it says what to return |
| Clarity | 5 | no "this thing", "stuff" or `[...]` gaps |

- **No inflation.** A path the model invents scores nothing, and the rewrite prompt forbids stating project facts that are not given.
- **A 100 is earned.** It only comes when the draft or the conversation brings the location and the facts. Without them the proposal stays at 86-93, tells the agent to find out, and the pane says what is missing: `Missing for 100: context 8/15`.

## Fits any terminal

<table>
  <tr>
    <td width="44%"><img src="assets/narrow.gif" alt="In a narrow terminal the band keeps the score and the button, and the pane sits above the prompt" width="100%"></td>
    <td>
      <ul>
        <li><b>Narrow</b> (under 40 columns): the band keeps only the score and the button.</li>
        <li><b>Short</b>: the buttons move above the editor, which takes the rows left over (3 to 14), and what is missing for 100 turns compact.</li>
        <li><b>Wide</b>: the pane docks beside the transcript.</li>
        <li><b>No room for the pane</b>: <code>/coach</code> returns the proposal in the transcript itself.</li>
        <li>Ghostty, iTerm, Terminal.app and the VS Code integrated terminal: Claude Code draws the interface, so the mod behaves the same in all of them.</li>
      </ul>
    </td>
  </tr>
</table>

## Haiku or Sonnet

<p align="center"><img src="assets/benchmark.svg" alt="Haiku costs $0.0007 per rewrite against $0.0114 for Sonnet, with nearly the same score and usefulness" width="88%"></p>

12 real drafts (`bench/cases.mts`), the same flow as the mod and a blind Opus judge scoring fidelity, invented facts and usefulness:

| Model | Avg score | At 100 | Invented | Usefulness | Cost per rewrite | Latency |
|---|---|---|---|---|---|---|
| **Haiku** | 93.5 | 5/12 | 3 | 7.8/10 | **$0.0007** | **5.2 s** |
| Sonnet | 95.3 | 5/12 | 1 | 8.0/10 | $0.0114 | 6.0 s |

Haiku is 16x cheaper with nearly the same quality, so it is the default. Rerun it with `node --experimental-strip-types bench/run.mts haiku,sonnet opus`.

## Install

From the Claude Code prompt:

```
/plugin install prompt-coach --marketplace diegoperezg7/prompt-coach
```

Answer `y` to add the marketplace and pick the user scope: it then works in the terminal and in the VS Code extension, which share user plugins. From a shell: `claude plugin install prompt-coach --marketplace diegoperezg7/prompt-coach`.

## Language

English and Spanish interface. The plugin's `language` option (`/plugin`, Prompt Coach, configure) takes:

| Value | Interface |
|---|---|
| `auto` (default) | follows the language of the draft |
| `en` | always English |
| `es` | always Spanish |

The proposal is always written in the draft's language, the one you work in.

## Surfaces

| Surface | Live score | Button | Hold on Enter |
|---|---|---|---|
| Terminal and desktop app | every keystroke | band (`m`) and `/coach` | no |
| VS Code extension | polls the composer every second (the extension does not send keystrokes) | band and `/coach` | yes: a weak work prompt is held and opens the pane; solid prompts, questions, commands and messages with attachments go through |

## Development

```
claude --plugin-dir .        # load without installing
claude plugin test .         # 16 tests: terminal, desktop and VS Code, several widths and heights, both languages
claude plugin validate .
```

| File | What it holds |
|---|---|
| `core/rubric.ts` | rubric, model prompts and local engine, with no Claude Code dependency |
| `hooks/register.tsx` | hooks, model calls, band and pane |
| `hooks/coach.test.tsx` | tests with the `claude-code/testing` kit |
| `bench/` | model benchmark with a blind judge |
| `types/index.d.ts` | the mod's state contract |
| `assets/demo.mp4` | 35 s demo video, ready to share |

## License

MIT
