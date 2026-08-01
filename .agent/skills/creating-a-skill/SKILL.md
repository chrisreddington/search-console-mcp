---
name: creating-a-skill
description: Create or edit an agent skill. Use whenever writing a new skill, restructuring one, or reviewing a skill for specificity, simplicity, and brevity.
---

# Creating a skill

Write an agent skill that is **specific** (unambiguous, repeatable), **simple** (one task, plain language), and **short** (no wasted tokens).

## Structure

- One directory per skill: `.agent/skills/<name>/SKILL.md`; `<name>` is kebab-case and matches `name`.
- `SKILL.md` is YAML frontmatter then a Markdown body in this order: `# Title`, one
  sentence stating what the skill produces, any instruction-bearing sections it needs,
  `## Rules`, `## Checklist`.
- Add bundled resource directories only when needed:
  - `scripts/` — runnable code for deterministic or repeated work.
  - `references/` — docs the agent reads on demand.
  - `assets/` — files used in output (templates, fonts, icons).

## Frontmatter standard

```yaml
---
name: <kebab-case-id>
description: <what it does AND when to trigger; specific contexts, not just keywords>
---
```

- Both keys are required; `description` is the sole trigger signal, so make it specific about when to invoke the skill, not just keywords.
- Keep frontmatter to these two keys unless a real need (e.g. `license`) arises.

## Agent skills vs. product skills

This repository contains two unrelated kinds of skill directory. Do not mix them.

- `.agent/skills/` — how to work _on_ this repository. Read by coding agents. Never shipped.
- `skills/` — the Search Console capability shipped _to_ end users by the Codex plugin
  (`.codex-plugin/plugin.json` points at it). Changing it changes product behaviour.

## Progressive disclosure

Load only what is needed, in three levels:

1. Frontmatter — always in context; keep it tight.
2. `SKILL.md` body — loaded when the skill triggers; keep it short.
3. Bundled resources — read or run on demand, not loaded upfront.

When the body grows long, move detail into `references/` and point to it from
`SKILL.md` with a one-line note on when to read it; give any reference over ~300
lines a table of contents.

## Rules

- One task per skill; if the title needs "and", split it.
- Write imperative, concrete instructions a second agent would apply the same way.
- Replace vague terms with checks ("mock I/O boundaries", not "mock external things").
- Explain _why_ only when it changes what the agent does; otherwise omit it.
- Prefer explaining reasoning over rigid ALL-CAPS MUSTs.
- Define required output with an explicit template; show an Input/Output example when format matters.
- Cut every word that carries no instruction.
- The skill's intent must match its description; never hide surprising or malicious behavior.

## Checklist

- Lives at `.agent/skills/<name>/SKILL.md`; `name` matches the directory.
- Frontmatter has `name` and a trigger-describing `description`.
- Body follows the Structure order; every section carries instruction.
- Every rule is imperative and verifiable; no line is filler.
- Bundled resources exist only where they replace repeated work or offloaded detail.
- Listed in the "Shared agent skills" section of `AGENTS.md`.
