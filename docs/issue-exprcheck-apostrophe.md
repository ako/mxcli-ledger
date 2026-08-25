# `mxcli check` rejects the `''` apostrophe escape in string literals

**Version:** `mxcli version 39c7d946 (2026-08-25T06:32:44Z)`
Also reproduced on `a44c735c`, `e26f1b74` and `1d0b82ce`.

## Summary

`exprcheck` reports every string literal containing an escaped apostrophe as a
malformed expression. `''` is how the Mendix expression language escapes an
apostrophe inside a string literal, so this is valid MDL and valid Mendix — and
every other tool in the chain agrees it is valid.

## Reproduction

```
$ cat apos.mdl
create or modify microflow Ledger.ProbeApos ()
returns string as $R
folder 'Insights'
begin
  declare $R string = '';
  set $R = 'a''b';
  return $R;
end;
/

$ mxcli check apos.mdl
✓ Syntax OK (1 statements)
✓ All references valid

(no module)
-----------
  ✗ Unexpected token after expression — the expression appears incomplete or
    malformed (possible missing space between keywords). []
      at
      → Check for glued keywords such as 'emptyor' (should be 'empty or') or
        'andtrue' (should be 'and true').

1 issues: 1 errors, 0 warnings, 0 info
```

The message is a red herring: nothing is glued and no keyword is involved.

## Everything else accepts the same expression

| check | verdict |
|---|---|
| `mxcli check` | **✗ 1 error** |
| `mxcli exec` + `DESCRIBE MICROFLOW` | round-trips as `set $R = 'a''b';` |
| `mx check Ledger.mpr` (Mendix 11.13.0) | `The app contains: 0 errors.` |
| the app's unit suite | passes — see below |

All three verified on `1d0b82ce` immediately after the failing `check` above.

The unit-suite row is the one that settles it. The project this was found in has
a test asserting that a microflow doubles an apostrophe when building an OData
`$filter` value. It runs the very expression `check` rejects, and it passes:

```
PASS  An apostrophe in a filter value is doubled, not passed through (1ms, 1 assertion)
Total: 42  Passed: 42  Failed: 0
```

## Cause

`mdl/exprcheck/lexer.go:68` scans to the next `'` with no notion of an escape:

```go
case c == '\'':
    j := i + 1
    for j < len(src) && src[j] != '\'' {
        j++
    }
    if j < len(src) {
        push(TokString, src[i:j+1], p)
        advance(j - i + 1)
    } else {
        push(TokError, src[i:], p)
        i = len(src)
    }
```

So `'a''b'` lexes as **two** string tokens, `'a'` and `'b'`. `parseOr` consumes
the first; the second is left unconsumed, and `Parse` reports the leftover at
`mdl/exprcheck/parser.go:42`.

Any literal carrying the escape trips it:

| intended value | source | result |
|---|---|---|
| `x` | `'x'` | clean |
| `a'b` | `'a''b'` | **error** |
| `x'` | `'x'''` | **error** |
| `'x` | `'''x'` | **error** |

Note `mdl/exprcheck/qualified_call_test.go` documents this same symptom — an
unconsumed-token error with an empty location — as a previously-fixed
false-positive class (#939). This is that check firing on a different input.

## Second defect: the finding carries no location

No rule id, no file, no line — in the text output above (`[]` and an empty
`at`), and in SARIF:

```json
{
  "level": "error",
  "ruleId": "",
  "locations": [
    { "physicalLocation": { "artifactLocation": { "uri": "" } } }
  ],
  "message": {
    "text": "Unexpected token after expression — the expression appears incomplete or malformed (possible missing space between keywords)."
  }
}
```

`parser.go` sets `Line` and `Column` from the offending token, so the position is
computed and then lost before the reporter. Isolating this meant bisecting a
600-line file by hand.

MDL-ORDER01 prints an empty `at` too, so this looks like the reporter rather
than this one rule.

## Impact

In one ~30-file project this produces 3 false errors across 2 files, correlating
exactly with the 3 escaped-apostrophe expressions in microflows. Escaping an
apostrophe is unavoidable whenever a microflow builds a quoted string — an OData
`$filter` value, an OQL predicate, a LIKE pattern.

Expressions in page widget properties with the same escape are **not** flagged,
so `exprcheck` appears not to run over widget properties. That is luck rather
than immunity.

## Suggested fix

1. Teach the lexer the `''` escape — on seeing a doubled quote inside a literal,
   consume the pair and continue rather than closing the token.
2. Give the reporter the file and line the parser already computes, and a rule
   id, so a finding like this is greppable instead of hand-bisected.
