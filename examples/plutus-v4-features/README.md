# Plutus V4 features on chain: `V4Features` on Musashi

One Pebble contract, compiled for Plutus V4
(`targetPlutusVersion: "experimental-v4"`), with a method for each purpose,
so a single script hash is at the same time a minting policy, a script
account, a guard and a spending address. Each method checks the part of the
V4 script context that its feature introduced, and each was executed on
**Musashi**, the public Leios testnet running the Dijkstra era at protocol
version 12.

The transactions, and how to verify them, are in
[`onchain/EVIDENCE.md`](./onchain/EVIDENCE.md).

| method | purpose | V4 feature it checks |
|---|---|---|
| `nested spend inSubTx` | spending, inside a sub-transaction | CIP-0118 sub-transaction index; required top-level guards |
| `mint mintOne` | minting | minted value |
| `withdraw observeWithdrawal` | withdrawing (account id) | withdrawals keyed by account |
| `withdraw observeAccounts` | withdrawing | direct deposits; account balance intervals |
| `certify registerAccount` | certifying | account-based certificates (account registration with deposit) |
| `nested guard subTxGuard` | guarding, inside a sub-transaction | CIP-0112 guard without a batch view |
| `guard batchGuard` | guarding, top-level transaction | CIP-0112 guard that sees the whole batch (`TopTxInfo`) |

## Reproducing

The script was compiled by the Pebble compiler at commit `cff5f0b0`: 0.5.0
plus the fix that lets withdraw methods read `context.credential`, which this
contract uses. The 0.5.0 release rejects this source (error 294, "`credential`
is not available in this contract method `context`"), so build the compiler
and the CLI from this repository. From the root of a checkout:

```bash
(cd packages/pebble && npm i && npm run build)                                 # the compiler
(cd packages/pebble-cli && npm i --no-save ../pebble && npm run build:no-gen)  # the CLI, on that compiler
cd examples/plutus-v4-features && rm out/out.flat
node ../../packages/pebble-cli/dist/index.js compile --config ./pebble.config.json
git status --short out              # prints nothing: out/out.flat is rebuilt byte for byte
node onchain/evaluate-locally.mjs   # 16 local cases, all PASS
```

`out/v4-features.plutus` wraps `out/out.flat` in a `PlutusScriptV4` text
envelope; its script hash, `067e368d715135fccf0d399f9d47ce9ec9b92dbc0d5e75ae44d17a14`,
is the hash of the script that every transaction in the evidence carries
(`python3 onchain/inspect-tx.py onchain/tx/<step>.signed` prints it). On a
Musashi node (see [`../plutus-v4-musashi`](../plutus-v4-musashi)
for the setup), with a funded payment key and a stake key:

```bash
export CARDANO_CLI=... CARDANO_NODE_SOCKET_PATH=... PPARAMS=pparams.json \
       PAYMENT_SKEY=... PAYMENT_VKEY=... STAKE_SKEY=... STAKE_VKEY=...
cd onchain
./run.sh register && ./run.sh mint && ./run.sh withdraw
./run.sh nested && ./run.sh accounts && ./run.sh batch-guard
```

Two transactions need fields that `cardano-cli` 11.3 cannot set, so a small
script edits the transaction `cardano-cli` built, before it is signed:

- [`add-body-fields.py`](./onchain/add-body-fields.py) adds direct deposits and
  account balance intervals to the body. They are not covered by the script
  data hash, so nothing else changes.
- [`copy-guard-witness.py`](./onchain/copy-guard-witness.py) gives the
  top-level transaction a Plutus script guard. `cardano-cli` accepts script
  guards only on sub-transactions, so the guard is built on a template
  sub-transaction and its guard, redeemer, script and script data hash are
  copied over; they are exactly the inputs of that hash.

[`inspect-tx.py`](./onchain/inspect-tx.py) prints, from any of the signed
transactions, the transaction and sub-transaction ids, the new V4 body fields,
the hash of every Plutus script carried and every redeemer with its ledger tag.
