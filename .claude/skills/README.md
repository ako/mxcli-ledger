# Skills

Reusable building blocks for Mendix work, packaged as [Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) —
a directory with a `SKILL.md` and whatever assets go with it. The frontmatter
`description` is what an agent always sees; the body loads when the skill triggers;
`references/`, `specs/` and `scripts/` are read only when needed. That layering is why a
skill can carry a spec library and a verifier without any of it sitting in the prompt.

Each of these exists because the block is **easier for a coding agent than for a person
in Studio Pro** — a large JSON specification, a Java action that has to be written and
compiled, a query rewritten by hand. The agent absorbs the awkward part; the skill is
what stops it having to rediscover the awkward part every time.

## Available

| Skill | What it gives you |
|---|---|
| [`mendix-vega-charts`](mendix-vega-charts/) | Vega-Lite charting through a pluggable widget that takes the spec and the data separately. Includes install and re-namespacing steps, seven working spec templates with sample data, a headless spec checker, and a catalogue of the failure modes that cost real time. |

## Wanted

Blocks that exist in other projects and would be worth packaging the same way. Listed so
the shape is agreed before anyone writes them — **not yet written**:

| Skill | What it would give you | Where the code is |
|---|---|---|
| `mendix-odata-pushdown` | Java actions that parse OData query parameters (`$filter`, `$orderby`, `$top`, `$skip`) and apply them to external database connector SQL, so paging and filtering happen in the source database instead of in memory. | the Formula 1 project |
| `mendix-bulk-oql-dml` | Java actions for bulk DML through OQL — supported by the platform, not exposed in Studio Pro — so a set-based update or delete does not have to become a loop over retrieved objects. | to be written |

Both are the same bet as the charting one: the awkward, verifiable, easily-got-wrong part
is written once, with its failure modes documented, and an agent applies it.

## What a skill here should carry

Whoever adds the next one: match the shape, because the shape is what makes these usable.

1. **`SKILL.md`** — frontmatter `name` and a `description` that says *when to reach for
   it*, then the body: what it is, who it is for, how to install it, how to use it, how
   to verify it.
2. **Installation that has been run**, not described from memory. The
   `mendix-vega-charts` re-namespacing steps are in the file because they were performed
   on a copy and the resulting package was inspected.
3. **Templates with sample inputs**, so the first use is a copy-and-edit rather than a
   blank page.
4. **A way to check the work without the full stack.** A spec checker, a unit test, a
   query plan — something with an exit code, runnable in seconds.
5. **The failure modes, with symptoms first.** What you have when you arrive is a
   symptom. Every entry should be one that actually happened, with the evidence that
   settled it.
