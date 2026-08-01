# On-chain evidence

All three Pebble examples, verified on chain.

* **Preprod** — the two self-contained examples (`linear-vesting`,
  `two-party-escrow`), compiled with **`@harmoniclabs/pebble@0.4.3`** and
  executed end-to-end.
* **Mainnet** — `the-cardano-masterpiece`, live in production and running the
  public site **<https://thecardanomasterpiece.com>**. See the second half of
  this file.

## Preprod

Every transaction below is confirmed on chain with `valid_contract: true`, i.e.
the ledger ran the Plutus script in phase 2 and it succeeded. Verify any of them
independently, e.g.
`curl https://cardano-preprod.blockfrost.io/api/v0/txs/<hash>` or the
Cardanoscan links.

## Linear vesting

| field | value |
|---|---|
| script hash | `ded0247df48b9e9086cdab2a6d96b922556ad4c7e2d7300e8029f356` |
| script address | `addr_test1wr0dqfra7j9eayyxek4j5mvkhy3926k5cl3dwvqwsq5lx4spr75rj` |
| compiled `out.flat` sha256 | `af3c3ef71908bb368896379266a590c1d5e579111741afdbffbb0a1452de281f` |
| `out.flat` size | 921 bytes |

Schedule: 100 ADA vesting from 2026-07-31T16:39:23.000Z to 2026-07-31T16:47:23.000Z.

| step | transaction | block |
|---|---|---|
| `vesting-lock` | [`38bc75ea88395c3d7f3ffaacd209a94bc3342baea647b3af4e7a7396744dec20`](https://preprod.cardanoscan.io/transaction/38bc75ea88395c3d7f3ffaacd209a94bc3342baea647b3af4e7a7396744dec20) | 5001171 |
| `vesting-claim-partial` | [`145536208765f639db6c1b5dec90c2e63397f16db0eb79f03a8f8e7b196b676d`](https://preprod.cardanoscan.io/transaction/145536208765f639db6c1b5dec90c2e63397f16db0eb79f03a8f8e7b196b676d) | 5001184 |
| `vesting-claim-final` | [`3b5a0aa49fb6d550f2729c6efaa52c0ab6ba5eac5f9fbe23fb3d5d94782c320e`](https://preprod.cardanoscan.io/transaction/3b5a0aa49fb6d550f2729c6efaa52c0ab6ba5eac5f9fbe23fb3d5d94782c320e) | 5001197 |

**Rejected by the validator** (built locally, script failed phase 2, never submitted):

- over-claim beyond vested amount

## Two-party escrow

| field | value |
|---|---|
| script hash | `941f4646a5d7bb55c500c8b9212b5414a49c1043c846c561e79ce8d1` |
| script address | `addr_test1wz2p73jx5htmk4w9qrytjgft2s22f8qsg0yyd3tpu7ww35gpw3eq0` |
| compiled `out.flat` sha256 | `ebeb9c9c986a37cc8d8de699345e01c1ee69c63182d7af2b47cf23f9fc9eefcd` |
| `out.flat` size | 782 bytes |

Contract parameters: buyer `eec87a16719960496c370f1a918eb45edc1763d52ce89c84faf2f25f`, seller `7f31214835929c443a23ade928e7319a50e58dd8d189e4b4b10425aa`, price 75 ADA.

| step | transaction | block |
|---|---|---|
| `seller-funding` | [`c66f26dc621eb0ea6529e4ccd9a2d19a0133d01dc995878b945488632a6989e6`](https://preprod.cardanoscan.io/transaction/c66f26dc621eb0ea6529e4ccd9a2d19a0133d01dc995878b945488632a6989e6) | 5001204 |
| `escrow-A-deposit` | [`ea45bdd7fda59da2e8621f1abf7fb7dd5811474a01cfdb976d7dc7feaaf4fd00`](https://preprod.cardanoscan.io/transaction/ea45bdd7fda59da2e8621f1abf7fb7dd5811474a01cfdb976d7dc7feaaf4fd00) | 5001205 |
| `escrow-A-accept` | [`cc7ebe90b4df4dd18110729ce83cda2fc1eafc5a66f88777f3ab4c3953108b11`](https://preprod.cardanoscan.io/transaction/cc7ebe90b4df4dd18110729ce83cda2fc1eafc5a66f88777f3ab4c3953108b11) | 5001206 |
| `escrow-B-deposit` | [`c6b92caf00d0f617f315e6accf5d2dfcdedd97c6064d53598cb34edf55dcef54`](https://preprod.cardanoscan.io/transaction/c6b92caf00d0f617f315e6accf5d2dfcdedd97c6064d53598cb34edf55dcef54) | 5001207 |
| `escrow-B-refund` | [`4c7ab60fbad22ed3c5c7dd00a74b3402ae0bfe58cbe9d9f9362a884f59ddb7b8`](https://preprod.cardanoscan.io/transaction/4c7ab60fbad22ed3c5c7dd00a74b3402ae0bfe58cbe9d9f9362a884f59ddb7b8) | 5001221 |
| `escrow-C-deposit` | [`76f40e7e7bea41df6cbf7cc373fc7c45b50ee00e825301db5a28ad384fe80c85`](https://preprod.cardanoscan.io/transaction/76f40e7e7bea41df6cbf7cc373fc7c45b50ee00e825301db5a28ad384fe80c85) | 5001223 |
| `escrow-C-settle` | [`a185b03f8b74460a29c7c7c0cd445917e921c77c69d7e240b98edac0d28495c6`](https://preprod.cardanoscan.io/transaction/a185b03f8b74460a29c7c7c0cd445917e921c77c69d7e240b98edac0d28495c6) | 5001224 |

**Rejected by the validator** (built locally, script failed phase 2, never submitted):

- refund attempted BEFORE the deadline
- accept attempted AFTER the deadline

---

## Reproducing

```bash
cd examples
npm install
npm run compile          # sha256 of out/out.flat must match the tables above
npm run preprod          # needs keys/ and BLOCKFROST_URL in .env.local
```

The compiled artifacts are reproducible: installing `@harmoniclabs/pebble@0.4.3`
and recompiling the committed sources yields byte-identical `out.flat` files.

---

# Mainnet evidence — the-cardano-masterpiece

The third example is not a test deployment: the three interacting validators are
live on **Cardano mainnet**. Included here so all three examples can be verified
the same way. Sourced from the submodule's own `website/config.json` and
re-verified against [Koios](https://api.koios.rest) on 2026-08-01.

## Reference-script deployments

| contract | transaction | block | epoch |
|---|---|---|---|
| stewardship | [`0db69e21cf87aee3db69947c2424cff18aa9b1a7a0edda8a36947794d3c0e6d4`](https://cardanoscan.io/transaction/0db69e21cf87aee3db69947c2424cff18aa9b1a7a0edda8a36947794d3c0e6d4) | 13728953 | 645 |
| masterpiece | [`40f95cacb59118e12e34488f036df90e723945985b8052d563e6611c4273ba12`](https://cardanoscan.io/transaction/40f95cacb59118e12e34488f036df90e723945985b8052d563e6611c4273ba12) | 13728954 | 645 |
| marketplace | [`6a9b8b6bf201e5d27f820852b81ede460891505fd694805b6a21ea474d419a57`](https://cardanoscan.io/transaction/6a9b8b6bf201e5d27f820852b81ede460891505fd694805b6a21ea474d419a57) | 13728958 | 645 |

## Live on-chain state

A deploy transaction only proves a script was published. These figures prove the
validators have **run**: tokens exist that only the mint validators could have
created, and the script addresses hold spendable state.

| contract | policy id | assets minted | script address | utxos |
|---|---|---|---|---|
| masterpiece | `33ff3caad94788284cff77194945f6507e7d7179087ecca4802dcdff` | 3 | `addr1wyel7092m9rcs2zvlam3jj297eg8ult30yy8an9ysqkumlc09y44u` | 85 |
| stewardship | `befeafc181f2ddd3870a6cd254be2fc4bfb16e2f7a24e4dc13b64b52` | 9 | `addr1wxl0at7ps8edm5u8pfkdy4979lztlvtw9aazfexuzwmyk5safalkp` | 6 |
| marketplace | `d412ed79133d70e53ae035d4bde5d73ac2c80c96857bfd826a23e604` | — | `addr1w82p9mtezv7hpef6uq6af0096uav9jqvj6zhhlvzdg37vpqnnfe2d` | 5 |

The masterpiece policy's 3 asset names are the CIP-68 `(100)`/`(222)` reference
and user tokens plus the shared leaf-marker name; the leaf tokens all carry the
same (empty) asset name by design, so the count of distinct names is small while
the number of tokens is not.

## The live product

The most direct evidence is that the contracts back a working public product:

**<https://thecardanomasterpiece.com>**

The site is a thin client over mainnet state, and exposes what it reads:

| endpoint | what it shows |
|---|---|
| [`/api/state`](https://thecardanomasterpiece.com/api/state) | live validator state — hatched leaves, committed image URI, policies |
| [`/bf/blocks/latest`](https://thecardanomasterpiece.com/bf/blocks/latest) | the mainnet tip it is reading from |

As of 2026-08-01 that endpoint reports **84 of 84 leaves hatched, 0 unhatched**,
a price floor of 2.5 ADA/pixel, and the same `masterpiecePolicy` /
`stewardshipPolicy` / `masterpieceAddress` verified against Koios above. Each
hatched leaf required a successful `Nursery.hatch` spend, so the count is a
direct tally of validator executions.

### The on-chain CID check

`/api/state` also reports the CIP-68 image URI committed on chain:

```
ipfs://bafybeidoy3mwz4jrbsvubvafndykruuun3rqpdydmbckdyebisg5krvkyi
```

This is worth singling out. `masterpiece.pebble` recomputes the **whole-image
IPFS CIDv1 on chain** (`src/lib/ipfs.pebble` implements dag-pb / UnixFS protobuf
framing in Pebble) so the CIP-68 `image` field is provably the canvas rather
than an assertion by an off-chain indexer.

That CID resolves on independent public gateways to a **1,017,142-byte
`image/bmp`**:

```bash
curl -sI https://ipfs.io/ipfs/bafybeidoy3mwz4jrbsvubvafndykruuun3rqpdydmbckdyebisg5krvkyi
curl -sI https://dweb.link/ipfs/bafybeidoy3mwz4jrbsvubvafndykruuun3rqpdydmbckdyebisg5krvkyi
```

1008 x 1008 pixels at 8 bits + a 1078-byte BMP header and palette is
`1016064 + 1078 = 1017142` bytes — exactly the size returned. The hash a Pebble
validator computed on chain therefore addresses precisely the artifact the
contract's own geometry predicts.

## Verifying independently

```bash
curl -X POST https://api.koios.rest/api/v1/tx_info \
  -H 'content-type: application/json' \
  -d '{"_tx_hashes":["0db69e21cf87aee3db69947c2424cff18aa9b1a7a0edda8a36947794d3c0e6d4"]}'

curl "https://api.koios.rest/api/v1/policy_asset_list?_asset_policy=33ff3caad94788284cff77194945f6507e7d7179087ecca4802dcdff"
```
