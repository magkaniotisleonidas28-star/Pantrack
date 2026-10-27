# Readability cleanup workflow

The [cleanup tracker](../CODE_READABILITY_TODO.md) owns section order and review
results. The [file inventory](CODE_READABILITY_FILE_MANIFEST.json) assigns each
baseline file once and records protected files, owner handoffs and cleanup additions.
Only one section is cleaned up at a time.

## Formatting convention

Prettier **3.9.10** is pinned as a development dependency. Existing runtime
packages and their locked resolutions are unchanged. This is the single tooling
addition needed for consistent formatting; it avoids a custom code printer.
The existing seven-day package release-age policy still applies.

Owned JavaScript/TypeScript uses two spaces, semicolons, single quoted strings,
100-column wrapping, double quoted JSX attributes and trailing commas. Imports,
object properties, arrays and declarations retain their original order. Embedded
language formatting is off so SQL/template contents are not rewritten. Prose
wrapping and HTML whitespace are preserved conservatively. Long literal strings
may remain longer than the print width.

## Check a section, then write it

Run from the project root:

```sh
pnpm format:check --section S01
pnpm format:write --section S01
```

Check mode exits unsuccessfully when eligible files need formatting. The write
command handles only that inventory section. It refuses arbitrary paths/globs and
checks the entire selection before writing. It also checks for intervening edits.
Do not use a blanket `prettier . --write` during this cleanup.

The command selects owned JS/TS and JSON/JSONC sources. Blocked files, generated
history, vendor sources and unsupported formats require a separate recorded
review. `.prettierignore` protects private state, migration history, generated
metadata, fixtures, vendor assets and managed instructions even in editor use.
Review YAML/shell/Python/HTML/CSS through their section's own parser and validation
steps; unsupported does not mean completed.

## Preservation checks

Before writing a candidate, the formatter compares TypeScript syntax structure,
public types, decoded literals, raw template text, declaration kinds, optional
chains, import order, shebang and comment/annotation contents. It separately
compares the emitted JavaScript structure; this covers JSX layout whitespace and
its resulting child values. Declaration files and JSON have no emitted JavaScript;
their full syntax/type/literal comparison is retained. Prettier's parser/round-trip check runs independently.
Formatting-only parentheses and empty statements can be normalized; an ASI or
control-flow change still refuses the candidate.

These checks supplement domain tests and review. They do not establish live
provider, browser, database concurrency, visual or production acceptance. Source
hashes and source-text assertions can observe formatting itself. Keep such holds
in the tracker, preserve historical proof records, and never weaken a verifier or
rewrite an old evidence hash to accept cleanup. Structural refactoring, renaming
and new explanatory comments need their own scoped review and relevant tests.

## Verification and review records

For each section, record the focused baseline, final tests, scoped lint,
typecheck/build and its extra database/HTTP/visual requirements. Review the diff
for unchanged API/UI/schema/security/transaction contracts and update file status
only after those checks. Keep a reviewed-unchanged record for protected sources.
The [local development guide](LOCAL_DEVELOPMENT.md) defines the isolated database
and HTTP commands. Do not copy the owner checkout's state or credentials.

The initial S01 baseline passed 137 suites and the six local checks. `pnpm lint`
already failed with **71 errors and 80 warnings** before source formatting.
This is inherited evidence, not permission to suppress rules or silently change
React behavior. Compare later lint findings by file/rule/message because line
numbers change with formatting. Log each unresolved issue in its owning section.
