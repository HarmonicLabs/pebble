# Plutus V4 on a public network: `HashLockV4` on Musashi

A Pebble contract compiled for **Plutus V4** (`targetPlutusVersion:
"experimental-v4"`) and executed on **Musashi**, the public Leios testnet,
which runs the **Dijkstra era (protocol version 12)**: the first public
network that executes `PlutusScriptV4` scripts. Preview and preprod still run
protocol version 11 until the Dijkstra hard fork.

[`src/index.pebble`](./src/index.pebble) is a hash lock whose spending reads
three parts of the V4 script context: the datum (the expected hash and the
earliest unlock time), the redeemer (the secret), and the transaction's
validity interval. A successful spend therefore shows that the V4 context, with
its list-encoded `ScriptContext`, `Tx` and `POSIXTimeRange` (plutus-ledger-api
1.71), decodes correctly on chain.

The on-chain run is recorded in [`onchain/EVIDENCE.md`](./onchain/EVIDENCE.md).

## Reproducing

Compile with Pebble 0.5.0, either the published CLI:

```bash
npm i -g @harmoniclabs/pebble-cli@0.5.0
pebble compile --config ./pebble.config.json     # -> out/out.flat
```

or the compiler and CLI built from this repository, as in
[`../plutus-v4-features`](../plutus-v4-features/README.md#reproducing): the
`v0.5.0` compiler and the compiler at `cff5f0b0`, which adds the withdraw fix,
both produce these exact bytes. Either way `git status --short out` prints
nothing afterwards: the rebuilt `out/out.flat` is the committed one, byte for
byte.

`out/hash-lock-v4.plutus` is the same program in a `PlutusScriptV4` text
envelope (`cborHex` is the CBOR byte string wrapping the flat encoding), which
`cardano-cli` accepts as a script file. Its script hash,
`c12677608f4872a8fad80dc61543c18ace733f2e2e8bac023e4f2f56`, is the one the
explorer reports for the unlock transaction.

Run a Musashi node (network magic 164): the binaries are on the
`ouroboros-leios` [releases page](https://github.com/input-output-hk/ouroboros-leios/releases)
and the configuration in the Cardano Book
([Musashi](https://book.play.dev.cardano.org/adv-musashi.html)). Fund a key from
the [faucet](https://faucet.leios.play.dev.cardano.org/basic-faucet), then:

```bash
export CARDANO_CLI=/path/to/leios/cardano-cli CARDANO_NODE_SOCKET_PATH=/path/to/node.socket
export PAYMENT_SKEY=payment.skey PAYMENT_ADDR=$(cat payment.addr) SHELLEY_GENESIS=/path/to/shelley-genesis.json
./onchain/run.sh lock                  # 20 ADA to the script, inline datum
./onchain/run.sh unlock-wrong-secret   # rejected by the script during evaluation
./onchain/run.sh unlock                # spends it: the V4 script runs on chain
```
