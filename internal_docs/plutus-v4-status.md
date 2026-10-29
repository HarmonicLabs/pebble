# Plutus V4 codegen — status

*Milestone 2 note. Re-verified against upstream on 2026-10-26
(previously 2026-09-29 against 1.69.0.0, and 2026-09-07 against 1.68.0.0).*

## What "Plutus V4 codegen" means for Pebble

For Pebble, Plutus V4 support is about the **ledger API**: the
Dijkstra-era script-context type definitions — the V4 `ScriptContext`,
`ScriptInfo`/`TxInfo` shapes and the purpose-dispatch changes of the new
ledger era. It is **not** about UPLC versions or UPLC term kinds:
everything at that level (UPLC 1.2 `case`/`constr`, builtin casing, the
batch-6 builtins) already shipped in the **van Rossem hard fork (protocol
version 11, intra-Conway, mainnet 2026-07-18)** and Pebble 0.5.0 emits it
today. Pebble contracts compiled now run on PV11 mainnet as `PlutusV3`
scripts with the extended builtin set.

## Upstream status (verified 2026-10-26)

**The V4 shapes are still moving.** Three weeks after 1.68.0.0 — the
release Pebble first targeted — upstream changed the encoding of every V4
product type, and a further field change is already merged for the next
release:

| date | upstream change | released in | effect on Pebble |
|---|---|---|---|
| 2026-09-10 | single-constructor V4 types encode as a plain `List` of fields instead of `Constr 0 fields` (plutus #7939); V4 wrappers added for `TxOutRef`, `GovernanceActionId`, `ProtocolVersion`, `Constitution`, `Committee`, `ProposalProcedure`, `Rational`, `AssetClass`, list-encoded too | 1.69.0.0 (2026-09-11) | **breaking — adopted**, see below |
| 2026-09-21 | V4 helper functions (plutus #7956) | 1.70.0.0 (CHaP, 2026-09-22) | none (no encoding change; 1.69 and 1.70 encode identically) |
| 2026-09-24 | `TopTxInfoSimplified.ttisScriptPurposes :: [ScriptPurpose]` becomes `ttisRedeemerHashes :: [ScriptHash]` (plutus #7963) | 1.71.0.0 (CHaP, 2026-09-29) | **breaking — adopted**: `TopTxInfoSimplified.redeemerHashes: List<ScriptHash>` |
| 2026-09-29 | builtin semantics variants F and G for Dijkstra (plutus #7966); Plutus Core 1.2.0 (#7964), allowed for V4 alongside 1.0.0 and 1.1.0 | 1.71.0.0 | none on encodings; Pebble emits Plutus Core 1.1.0, which V4 accepts |
| — | 1.72.0.0 (CHaP, 2026-10-17) | — | not yet checked against the fixtures; the public Dijkstra-era testnet (Musashi) runs 1.71 |

Pebble 0.5.0 tracks **plutus-ledger-api 1.71.0.0**, the version the
public Dijkstra-era testnet (Musashi, protocol version 12) runs: its
cardano-ledger `leios-prototype` build requires `plutus-ledger-api >= 1.71`
and its CHaP index-state (2026-10-09) predates 1.72. Between 1.68 and 1.69
only the wrapper of the product types changed (13 of the 39 original
fixtures, all for that reason; 16 fixtures were added for the new wrappers
and the governance actions); between 1.69 and 1.71 only the field above.

The V4 definitions themselves are **no longer missing**:

- **plutus-ledger-api 1.68.0.0 (released 2026-08-21)** ships
  `PlutusLedgerApi.V4` — complete script-context types
  (`plutus-ledger-api/src/PlutusLedgerApi/V4/Contexts.hs`), a V4
  `ParamName` cost-model parameter list, a V4 `EvaluationContext`, and
  `dijkstraPV = MajorProtocolVersion 12` ("The Dijkstra HF will introduce
  the Dijkstra era and Plutus V4"). 1.67 carried the first draft; 1.68
  formalized it.
- **cardano-ledger master** has the full Dijkstra-era
  `EraPlutusTxInfo 'PlutusV4 DijkstraEra` translation
  (`eras/dijkstra/impl/src/Cardano/Ledger/Dijkstra/TxInfo.hs`).

The V4 context is a substantial redesign, driven by
**CIP-0118 (Nested Transactions)** + **CIP-0112 (Observe/Guard scripts)**
plus the spending-accounts work:

- `ScriptContext` gains a 4th field, `scriptContextScriptHash`.
- `TxInfo` is reordered (`txInfoId` first) and reshaped: new
  `txInfoSubTxIx`, `txInfoDirectDeposits`,
  `txInfoAccountBalanceIntervals`, `txInfoGuards`,
  `txInfoRequiredTopLevelGuards`; `txInfoFee` and `txInfoSignatories`
  are GONE.
- `ScriptPurpose` now carries the executing `ScriptHash` in every
  constructor, and a new `Guarding` purpose (index 6) exists; the
  matching `GuardingScript` `ScriptInfo` carries an optional `TopTxInfo`
  describing the whole batch (sub-transactions, aggregated view).
- New `AccountId` / `AccountBalanceInterval(s)` types; `TxCert` is
  rebuilt around accounts (`TxCertRegAccount`, ... — 11 constructors).
- New V4 `Address` type and a new `POSIXTimeRange` datatype.

## What still blocks the milestone's acceptance criterion

The acceptance criterion needs a V4 script **executing on a public
preview/preprod node**. That requires the Dijkstra hard fork (PV12), and:

- no public preview/preprod network runs the Dijkstra era yet;
- the **cost-model values** for V4 are not final (the `ParamName` shape
  exists; new CIP-0168 builtin costings were still being added to V4
  after the 1.68 release — 2026-08-25/28);
- CIP-0118, which the V4 context shape encodes, is still **Proposed**,
  and the shapes DID shift after the release Pebble first targeted (see
  the table above) — more changes before the fork should be expected.

## Work now possible (and what remains)

With released type definitions, Pebble can now:

1. ~~add the V4 prelude types~~ **DONE, against plutus-ledger-api
   1.71.0.0**: `ScriptContext` / `Tx` / `ScriptInfo` / `ScriptPurpose` /
   `TxCert` / accounts / guards / `TopTxInfo` ship in the prelude under
   `targetPlutusVersion: "experimental-v4"`, with the product types
   list-encoded, validated against golden fixtures generated by running
   the released library's own `toData` on sample values of every V4 type
   (`compiler.v4Prelude.test.ts` + `fixtures/v4-data-encodings.json`;
   the dump program at `packages/pebble/scripts/v4-fixtures` builds
   plutus-ledger-api 1.71 via cabal/CHaP). The
   `contract` sugar is V4-aware too: it compiles under
   `targetPlutusVersion: "experimental-v4"` and gains the `guard` method
   keyword for the guarding purpose (`context.guardIndex`,
   `context.topTxInfo`) and the `top` / `nested` execution-level method
   keywords (the body matches `tx.subTxIx` before the purpose; level-less
   contracts are top-only), tested against fixture-derived contexts
   (`compiler.contractGuard.test.ts`, `compiler.contractLevels.test.ts`);
2. wire the V4 cost-model shape (`cardano-costmodels-ts` `v4`) into the
   test runner once parameter values are published;
3. emit the `PlutusScriptV4` envelope/tag in the export pipeline and in
   buildooor (witness-set key 8, language views) when the ledger
   finalizes them;
4. compile and execute an example on the first Dijkstra-capable
   preview/preprod network and commit the evidence.

Items 2–4 wait on the fork's finalization; re-run the fixture dump and
the `compiler.v4Prelude` suite whenever upstream moves the shapes. The
first test of that suite asserts which fixtures are lists and which are
constructors, so an encoding change upstream is named before any decode
fails.

Next: check 1.72.0.0 (released 2026-10-17) against the fixtures once a
public network runs it.
