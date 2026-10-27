# On-chain evidence: a Pebble Plutus V4 script executed on Musashi

**Result:** `HashLockV4`, compiled by Pebble 0.5.0 for Plutus V4, was spent on
**Musashi** on 2026-10-27. The ledger ran it as a `PlutusV4` script under
protocol version 12, it succeeded (`valid_contract: true`, collateral
untouched), and the spending transaction reached the chain through a
**Leios-certified endorser block**.

## Network

| | |
|---|---|
| network | Musashi, the public Leios testnet (network magic 164), the spin started 2026-10-18T00:00:00Z (Shelley genesis hash `d1b19e006c1198fb7ac9d53073c1a9f77acb1a9474c92310006ae4418290cda3`) |
| era / protocol version | Dijkstra, **12.0** (`cardano-cli query protocol-parameters`, and the block headers below) |
| Plutus V4 | cost model with 251 parameters in the protocol parameters; the ledger build requires plutus-ledger-api >= 1.71 |
| node used | cardano-node 11.2.0.164 from the `ouroboros-leios` release `rc-2026w43`, configuration from the [Cardano Book](https://book.play.dev.cardano.org/adv-musashi.html) |

Preview and preprod were still on protocol version 11 on the same day, so they
cannot execute Plutus V4 scripts until the Dijkstra hard fork.

## Script

| | |
|---|---|
| source | [`../src/index.pebble`](../src/index.pebble), `targetPlutusVersion: "experimental-v4"` |
| compiler | `@harmoniclabs/pebble` 0.5.0 (tag `v0.5.0`); `pebble compile` reproduces [`../out/out.flat`](../out/out.flat) byte for byte |
| program | 321 bytes flat-encoded, Plutus Core 1.1.0; [`../out/hash-lock-v4.plutus`](../out/hash-lock-v4.plutus) is the `PlutusScriptV4` envelope (324 bytes on chain) |
| script hash | `c12677608f4872a8fad80dc61543c18ace733f2e2e8bac023e4f2f56` |
| address | `addr_test1wrqjvamq3ay89286mqxuv92rcx9vuuel9chghtqz8e8j74st4fjza` |

Spending checks `sha2_256( secret ) == datum.secretHash` and that the
transaction's validity interval starts no earlier than `datum.notBefore`, and it
is valid only at the top level of a transaction (not inside a CIP-0118
sub-transaction). It therefore decodes the datum, the redeemer and the
transaction's validity interval out of the V4 script context.

## Transactions

| step | transaction | block | result |
|---|---|---|---|
| fund (faucet) | [`6c9274f73b17f30d7c6084c7812374d175d8a1cedd893c1f1a5d5b519184c18f`](https://kleioscan.com/#/musashi/tx/6c9274f73b17f30d7c6084c7812374d175d8a1cedd893c1f1a5d5b519184c18f) | | 10,000 ADA to the test wallet |
| lock | [`c4af6685095147d8e9f0a2447f602660d83bc50f91a60e8bece363a238bd0855`](https://kleioscan.com/#/musashi/tx/c4af6685095147d8e9f0a2447f602660d83bc50f91a60e8bece363a238bd0855) | 37049 (slot 834895, 15:54:55 UTC) | 20 ADA to the script with the inline datum [`tx/datum.json`](tx/datum.json) (`notBefore` = 1793116482000) |
| unlock, wrong secret | not submitted | | rejected by the script during evaluation, see below |
| **unlock** | [`e36e3e7a37d6ade13951d793c8646b17105ffafffc7acce7681a822ba2c6195c`](https://kleioscan.com/#/musashi/tx/e36e3e7a37d6ade13951d793c8646b17105ffafffc7acce7681a822ba2c6195c) | **37057** (slot 835036, 15:57:16 UTC) | **script ran and succeeded**: `valid_contract: true`, `plutusV4`, 31,996 memory / 9,258,110 CPU units |

| block | hash | contents |
|---|---|---|
| 37049 | `8f3fd9249d995f5393dd8fd832d0bb479508c4c91201c0870629405a9ef9a00f` | ranking block, 395 transactions, including the lock |
| 37057 | `2e0a241cca26a34e0fa53c42ed05ab52949817375e8eeb0287f020e3be81a1cf` | ranking block certifying endorser block `07fd04d010856055d292ab41c5a6e68227e3d41f6a19e2ea9733de821f213613`, 1,414 transactions, including the unlock |

The signed transactions are in [`tx/`](tx/). After the unlock, the script output
`c4af…#0` is spent, the unlock's output `e36e…#0` holds the 20 ADA minus the
0.193 ADA fee, and the collateral `c4af…#1` is still unspent: collateral is only
taken when a script fails.

### Leios

Block 37057 is a 74-byte ranking block with `has_leios_cert: true`: it
certifies endorser block `07fd04d010856055d292ab41c5a6e68227e3d41f6a19e2ea9733de821f213613`
(51,364 bytes, closure 339,954 bytes), which brings in the block's 1,414
transactions. The unlock is transaction 1001 of them, so it was included
through the certified endorser block. The lock was included directly in the
ordinary ranking block 37049 (395 transactions).

### The rejected unlock

The same unlock with the secret `wrong` fails transaction building, because
`cardano-cli` evaluates the script with the ledger's evaluator before signing
(full output in [`tx/unlock-wrong-secret.log`](tx/unlock-wrong-secret.log)):

```text
Script language: PlutusV4
Protocol version: Version 12
...
Script evaluation error: An error has occurred:
The machine terminated because of an error, either from a built-in function or from an explicit use of 'error'.
Caused by: (error)
Script execution logs: wrong secret
```

`wrong secret` is the contract's own message, so the script decoded the context
and failed exactly at the secret check.

### Local evaluation

[`evaluate-locally.mjs`](evaluate-locally.mjs) runs the same program on the CEK
machine against contexts built from the real plutus-ledger-api 1.71 encodings:

```text
PASS valid unlock               accepted | cpu 9646966 mem 31996
PASS wrong secret               rejected (wrong secret) | cpu 9541473 mem 32656
PASS too early                  rejected (too early) | cpu 9900574 mem 32650
PASS no lower bound             rejected | cpu 5689718 mem 20116
PASS inside a sub-transaction   rejected | cpu 1678143 mem 6820
```

The memory used by the valid unlock matches the on-chain budget exactly
(31,996); the CPU figure differs because the local machine prices steps with
its default cost model, not Musashi's V4 one.

## Verifying independently

The transaction ids can be recomputed from the committed signed transactions,
which also show the script, the datum, the redeemer and the execution units that
went on chain:

```bash
cardano-cli dijkstra transaction txid --tx-file tx/lock.signed     # c4af6685…0855
cardano-cli dijkstra transaction txid --tx-file tx/unlock.signed   # e36e3e7a…195c
cardano-cli debug transaction view --tx-file tx/unlock.signed
```

On the live network:

```bash
# KleioScan (db-sync based explorer), no account needed
curl -s https://kleioscan.com/api/musashi/txs/e36e3e7a37d6ade13951d793c8646b17105ffafffc7acce7681a822ba2c6195c \
  | jq '{block_no, valid_contract, scripts: [.scripts[] | {script_hash, script_type, unit_mem, unit_steps}]}'
curl -s https://kleioscan.com/api/musashi/blocks/37057 | jq '{block_no, proto_major, has_leios_cert, certified_eb_hash, tx_count}'

# or against a Musashi node
cardano-cli dijkstra query utxo --testnet-magic 164 \
  --tx-in c4af6685095147d8e9f0a2447f602660d83bc50f91a60e8bece363a238bd0855#0   # spent: empty
cardano-cli dijkstra query utxo --testnet-magic 164 \
  --tx-in e36e3e7a37d6ade13951d793c8646b17105ffafffc7acce7681a822ba2c6195c#0   # the unlock's output
```

### If Musashi has been respun

Musashi is restarted from a new genesis when a prototype release changes the
chain format. KleioScan then keeps the previous chain under its own network id
(earlier spins are listed as `musashi-w40` and `musashi-old` at
<https://kleioscan.com/api/networks>), so the links above would need that id in
place of `musashi`. This chain is identified by the network magic and Shelley
genesis hash in the table at the top. The explorer's records of both
transactions and both blocks, as served on 2026-10-27, are saved in
[`tx/kleioscan/`](tx/kleioscan/).
