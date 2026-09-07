# V4 encoding fixture generator

Generates `src/compiler/__tests__/fixtures/v4-data-encodings.json`: the
ACTUAL `Data` encodings of every `PlutusLedgerApi.V4` type, produced by
the released plutus-ledger-api itself (not by reading its source). The
`compiler.v4Prelude.test.ts` suite decodes these back through pebble's
`*V4` prelude types on the CEK machine.

Re-run whenever upstream moves the V4 shapes (CIP-0118 is still
Proposed; bump the plutus version bound in `v4dump.cabal` and the CHaP
index-state in `cabal.project` as needed):

```bash
# needs GHC 9.6.6+ and cabal 3.10+
cabal update
cabal build
cabal run v4dump | grep -v Resolving > fixtures.txt
# then convert `name <hex>` lines into the JSON's "fixtures" object
```
