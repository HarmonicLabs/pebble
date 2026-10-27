# On-chain evidence: Plutus V4 features executed by a Pebble script

**Result:** on 2026-10-27 the Pebble-compiled Plutus V4 script `V4Features`
ran on **Musashi** (public Leios testnet, Dijkstra era, protocol version 12)
for every purpose that the available tooling can put in a transaction:
certifying, minting, withdrawing, spending inside a CIP-0118 sub-transaction,
CIP-0112 guards inside a sub-transaction and on the top-level transaction,
and a transaction carrying direct deposits and account balance intervals.
Each transaction was accepted with `valid_contract: true`; the mempool and
the ledger run every Plutus script of a transaction, including those of its
sub-transactions, before accepting it.

## Script

| | |
|---|---|
| source | [`../src/index.pebble`](../src/index.pebble), `targetPlutusVersion: "experimental-v4"` |
| compiler | Pebble at commit `cff5f0b0` (0.5.0 plus the withdraw `context.credential` fix); `pebble compile` reproduces [`../out/out.flat`](../out/out.flat) byte for byte |
| program | 965 bytes flat-encoded; [`../out/v4-features.plutus`](../out/v4-features.plutus) is the `PlutusScriptV4` envelope |
| script hash | `067e368d715135fccf0d399f9d47ce9ec9b92dbc0d5e75ae44d17a14` (blake2b-224 of `0x04` ‖ script: the V4 language tag) |
| spending address | `addr_test1wqr8ud5dw9gntlx0p5uel828e60vnwfdhsx4uadwgngh59qd6mr7n` |
| script account | `stake_test17qr8ud5dw9gntlx0p5uel828e60vnwfdhsx4uadwgngh59qdj9mfe` |

The network is the Musashi spin started 2026-10-18 (network magic 164,
Shelley genesis hash `d1b19e006c1198fb7ac9d53073c1a9f77acb1a9474c92310006ae4418290cda3`);
see [`../../plutus-v4-musashi/onchain/EVIDENCE.md`](../../plutus-v4-musashi/onchain/EVIDENCE.md).

## Transactions

| feature | what the script checks | transaction | block (number, hash) | redeemer tag |
|---|---|---|---|---|
| account-based certificate (certifying) | the certificate registers a **script** account with the 2 ADA deposit | [`ffab987ef36b8eb9a8c78985dfc329091cf2a5aa19e71c9a60f78f425864ead8`](https://kleioscan.com/#/musashi/tx/ffab987ef36b8eb9a8c78985dfc329091cf2a5aa19e71c9a60f78f425864ead8) | 37257, `73b916be89ec271e878fabff522d69cc45e9b1d404d048bd9484d0f4dabee453` | 2 cert |
| minting | exactly one `v4` token of its policy is minted | [`c4531fc8ac0d6287e634d4880453551a7dbee17f28693b38236dd3a626189b61`](https://kleioscan.com/#/musashi/tx/c4531fc8ac0d6287e634d4880453551a7dbee17f28693b38236dd3a626189b61) | 37275, `f8366fd14caf49527989cab72963100803b38c93eaf6c68edf9d5027b761eff2` | 1 mint |
| withdrawing (keyed by account) | its account withdraws 0 | [`6a0d8f1e809079dc17f56a6a935ed1064e6cb1a05299fc696310f6563c4dbcc9`](https://kleioscan.com/#/musashi/tx/6a0d8f1e809079dc17f56a6a935ed1064e6cb1a05299fc696310f6563c4dbcc9) | 37286, `d535cf402e2e8b6e61ca4af38806916cc303edd587cabb47fcc05ac6176f4cea` | 3 reward |
| nested transaction (CIP-0118): spend inside a sub-transaction | it runs inside a sub-transaction (`subTxIx` is `Some`), and the sub-transaction requires the payment key as a top-level guard | [`22b4675dc685a79c79a42e705989c878ed46feb6b680387cd079b709145d5f36`](https://kleioscan.com/#/musashi/tx/22b4675dc685a79c79a42e705989c878ed46feb6b680387cd079b709145d5f36), sub-transaction `5abad9c5334a7ba924099db5de3f2197370adfc71d7726cef1ba4e1636652552` | 37310, `d8a7455d3c0bc6c72a170ceac3d996afe5a34cbc9aa3d89771c397e588050e49` | 0 spend |
| guard inside a sub-transaction (CIP-0112) | it gets no batch view (`topTxInfo` is `None`) | same sub-transaction | 37310 | **6 guarding** |
| direct deposits and account balance intervals | the transaction deposits 1 ADA into the key account, and bounds the script account's balance to `[0, 1 ADA)` | [`048dfd10e2879820e77416093528e88f80201168ff98357e9a17f3418821565b`](https://kleioscan.com/#/musashi/tx/048dfd10e2879820e77416093528e88f80201168ff98357e9a17f3418821565b) | 37324, `856c01414e3645d45a0252ab75a1a42f2a4fe96ab450fc59d0217bc1719d983b` | 3 reward |
| guard of the top-level transaction (CIP-0112) | it sees the whole batch: `topTxInfo` is `Some` and lists exactly one sub-transaction | [`cd1f02c217bcdeedbc5d45225d18326d6da9274e9bcf996d1e4be35e399ba448`](https://kleioscan.com/#/musashi/tx/cd1f02c217bcdeedbc5d45225d18326d6da9274e9bcf996d1e4be35e399ba448), sub-transaction `d3374a0dbe9604e54247fbe06dd8839bdd045350e1a01253d2a2dd352dd9f607` | 37362, `5e04c962db11dc45a41e8141b37351c8ce46b549598bc6c989cfe33f5a675d3c` | **6 guarding** |

Supporting transaction: [`7e16948c216c58d6d77a798f87adf1481ef62f62a39f82428d04b7db7dd9b2ef`](https://kleioscan.com/#/musashi/tx/7e16948c216c58d6d77a798f87adf1481ef62f62a39f82428d04b7db7dd9b2ef)
(block 37301) locked the 10 ADA that the sub-transaction of `22b4675d…` spends.

All seven blocks carry protocol version 12.0. Blocks 37257 and 37286 are
ranking blocks with a Leios certificate: the registration and the withdrawal
reached the chain through certified endorser blocks.

**Effects on chain.** After `048dfd10…`, `cardano-cli query stake-address-info`
reports a balance of exactly 1 ADA (1,000,000 lovelace) for the key account
`stake_test1uzn2xeq4lyuc39atjtdd7jxt0wzxp8m3mfyydyza5rm3euceaf76l`, which held
nothing before: the direct deposit was applied. The script account still holds
0, inside the declared interval.

**Execution units.** Transactions built by `cardano-cli transaction build`
carry the units the ledger's evaluator measured: registration 21,499 memory /
5,460,085 CPU, mint 24,723 / 6,283,564, withdrawal 22,294 / 6,877,565. The
other three were assembled with `build-raw`, which takes declared units, so
they declare a generous 2,000,000 / 1,000,000,000 per script; the ledger only
requires the declared units to cover the run.

## How the last two were built

`cardano-cli` 11.3, the Musashi build, cannot set every Dijkstra field, and
Pebble's own builder (buildooor) has no Dijkstra support yet:

- **Direct deposits and account balance intervals** (body keys 25 and 26) have
  no `cardano-cli` options. [`add-body-fields.py`](add-body-fields.py) adds
  them to the body that `cardano-cli transaction build-raw` produced
  ([`tx/accounts.cli.raw`](tx/accounts.cli.raw)), without re-encoding anything
  else; the transaction is then signed. The script data hash does not cover
  body fields, so it stays valid.
- **A script guard on the top-level transaction** is only accepted by
  `cardano-cli` on sub-transactions. [`copy-guard-witness.py`](copy-guard-witness.py)
  takes the guard (body 14), the script data hash (body 11), the redeemer
  (witness 5) and the script (witness 8) from a template sub-transaction built
  with that guard ([`tx/batch-guard-template.raw`](tx/batch-guard-template.raw),
  never submitted) and puts them into the top-level transaction
  ([`tx/batch.cli.raw`](tx/batch.cli.raw)). The script data hash covers exactly
  the redeemers, the datums and the language's cost model, which are the same
  in both. The ledger also requires a Plutus script listed as a required
  top-level guard to carry a datum (`SubMalformedGuardDatums` otherwise), so
  the sub-transaction gives it one.

## Explorer note

KleioScan lists the two guarding redeemers with purpose `propose` and without a
script; its purpose list predates tag 6. The tag is in the transactions
themselves (output abridged where marked `...`):

```text
$ python3 inspect-tx.py tx/nested.signed
top-level transaction          id 22b4675dc685a79c79a42e705989c878ed46feb6b680387cd079b709145d5f36
sub-transaction 0              id 5abad9c5334a7ba924099db5de3f2197370adfc71d7726cef1ba4e1636652552
top-level transaction          body 14 (guards): [[0, '5f4f2c92cad820eeab9e21c7aa197c6678353da4a2b2fc5450713ec8']]
sub-transaction 0              body 14 (guards): [[1, '067e368d715135fccf0d399f9d47ce9ec9b92dbc0d5e75ae44d17a14']]
sub-transaction 0              body 24 (required top-level guards): [([0, '5f4f2c92cad820eeab9e21c7aa197c6678353da4a2b2fc5450713ec8'], None)]
sub-transaction 0              tag 0 (spend), index 0, redeemer {"constructor": 0, ...}
sub-transaction 0              tag 6 (guarding), index 0, redeemer {"constructor": 5, "fields": []}

$ python3 inspect-tx.py tx/batch.signed
top-level transaction          id cd1f02c217bcdeedbc5d45225d18326d6da9274e9bcf996d1e4be35e399ba448
sub-transaction 0              id d3374a0dbe9604e54247fbe06dd8839bdd045350e1a01253d2a2dd352dd9f607
top-level transaction          body 14 (guards): [[1, '067e368d715135fccf0d399f9d47ce9ec9b92dbc0d5e75ae44d17a14']]
top-level transaction          tag 6 (guarding), index 0, redeemer {"constructor": 6, "fields": [{"int": 1}]}
sub-transaction 0              body 24 (required top-level guards): [([1, '067e368d715135fccf0d399f9d47ce9ec9b92dbc0d5e75ae44d17a14'], [])]

$ python3 inspect-tx.py tx/accounts.signed
top-level transaction          body 25 (direct deposits): [('e0a6a36415f9398897ab92dadf48cb7b84609f71da4846905da0f71cf3', 1000000)]
top-level transaction          body 26 (account balance intervals): [('f0067e368d715135fccf0d399f9d47ce9ec9b92dbc0d5e75ae44d17a14', [0, 1000000])]
top-level transaction          tag 3 (reward), index 0, redeemer {"constructor": 3, ...}
```

## Not covered, and why

| feature | reason |
|---|---|
| voting purpose | voting needs an open governance action; Musashi's only one is already enacted |
| proposing purpose | a proposal needs a 100,000 ADA deposit; the faucet gives 10,000 |
| starting account balance intervals (body 27) | not exercised; it is visible to top-level guards through `TopTxInfo` and could be added like body 26 |
| the executing script's own hash (`ScriptContext` field 4) | present in every run above, but the contract does not read it |

## A bug found on the way

Withdraw methods could not read the withdrawing account as
`context.credential`: the contract sugar exposed it only as `context.policy`,
copied from the mint branch. Fixed in `cff5f0b0`, with regression tests for
both targets; the script above uses the fix.

## Local evaluation

[`evaluate-locally.mjs`](evaluate-locally.mjs) runs the same program against
contexts built from the plutus-ledger-api 1.71 encodings, one accepted and at
least one rejected case per method: 16 of 16 pass.

## Verifying independently

```bash
# transaction and sub-transaction ids, the new body fields and the redeemer tags,
# straight from the committed signed transactions
python3 inspect-tx.py tx/batch.signed
# KleioScan; records as served on 2026-10-27 are saved in tx/kleioscan/
curl -s https://kleioscan.com/api/musashi/txs/cd1f02c217bcdeedbc5d45225d18326d6da9274e9bcf996d1e4be35e399ba448 \
  | jq '{block_no, valid_contract, sub_txs, scripts: [.scripts[] | {index, redeemer_json, unit_mem, unit_steps}]}'
# the direct deposit, on a Musashi node
cardano-cli dijkstra query stake-address-info --testnet-magic 164 \
  --address stake_test1uzn2xeq4lyuc39atjtdd7jxt0wzxp8m3mfyydyza5rm3euceaf76l
```
