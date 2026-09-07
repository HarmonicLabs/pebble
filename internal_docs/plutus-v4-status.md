# Plutus V4 codegen — status

*Milestone 2 note, 2026-09. Updated as upstream definitions land.*

## What "Plutus V4 codegen" means for Pebble

For Pebble, Plutus V4 support is about the **ledger API**: the
Dijkstra-era script-context type definitions — a V4 `ScriptContext`, the
V4 `ScriptInfo`/`Tx` shapes, and whatever purpose-dispatch changes the new
ledger era introduces. It is **not** about UPLC versions or UPLC term
kinds: everything at that level (UPLC 1.2 `case`/`constr`, builtin casing,
the batch-6 builtins — `dropList`, `expModInteger`, arrays, the
multi-asset `Value` builtins, BLS multi-scalar multiplication) already
shipped in the **van Rossem hard fork (protocol version 11, intra-Conway,
mainnet 2026-07-18)** and Pebble 0.5.0 emits it today. Pebble contracts
compiled now run on PV11 mainnet as `PlutusV3` scripts with the extended
builtin set.

## Why it cannot be implemented yet

Plutus V4 is a **Dijkstra-era** feature — the *next* hard fork, not van
Rossem. As of this writing there is:

- **no finalized V4 script-context specification** — the
  `plutus-ledger-api` V4 context types do not exist upstream; only
  ledger-level plumbing is sketched (script ref tag 4, witness-set key 8,
  aux-data key 5, per the IntersectMBO `cardano-ledger` Dijkstra CDDL);
- **no final V4 cost model** — `@harmoniclabs/cardano-costmodels-ts`
  carries a `v4` module explicitly reserved for the future language
  version;
- **no `PlutusScriptV4` on-chain language tag** a transaction could carry;
- **no public preview/preprod network running V4** to produce execution
  evidence on.

The milestone's V4 deliverable is therefore blocked on missing upstream
definitions, and on nothing else.

## What the work will be, once the definitions exist

1. Add the V4 prelude types (`ScriptContext`/`ScriptInfo`/`Tx` variants
   and any new purpose shapes) alongside the V3 ones in
   `src/compiler/tir/program/stdScope/stdScope.ts`, selectable as a
   compilation target.
2. Wire the finalized V4 cost model (`cardano-costmodels-ts` `v4`) into
   the test runner and budget reporting.
3. Emit the `PlutusScriptV4` envelope/tag in the export pipeline and in
   downstream tooling (buildooor: witness-set key 8, language views for
   `scriptDataHash`).
4. Compile and execute an example contract on the first V4-capable
   preview/preprod network and commit the evidence (tx link / logs).

Everything else in Milestone 2 — the test framework, the stdlib
expansion, the UPLC-CAPE submissions and the benchmark write-up — is
delivered without waiting on the fork.
