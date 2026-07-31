# Pebble examples

Three example contracts, in increasing order of complexity, each compiling
end-to-end to on-chain UPLC and each exercised against a local devnet.

| example | lines | what it shows |
|---|---|---|
| [`linear-vesting`](./linear-vesting) | ~100 | a datum that carries state across partial spends; reading the validity interval's **lower** bound |
| [`two-party-escrow`](./two-party-escrow) | ~95 | contract `param`s; three redeemer endpoints; reading **both** interval bounds; payment tagging against double satisfaction |
| [`the-cardano-masterpiece`](./the-cardano-masterpiece) → symlink | ~1200 | **multiple contracts that compose** — mainnet-deployed |

The first two are self-contained and are the ones to read first. The third is a
symlink to a real, mainnet-deployed project; see [Advanced](#advanced-the-cardano-masterpiece).

---

## Running them

Both self-contained examples compile with the published compiler and run
against a local devnet.

```bash
npm install

# compile both contracts to out/out.flat
npm run compile

# bring up a 3-node PV11 devnet (~4 minutes; needs cardano-node,
# cardano-cli and cardano-testnet on PATH)
bash devnet/bootstrap-devnet.sh

# build, submit and verify real transactions
npm run e2e
```

`bootstrap-devnet.sh` generates a `cardano-testnet` environment under
`.devnet/`, converts it to protocol version 11, and installs the full 350-param
PlutusV3 cost model by governance action. PV11 is required: Pebble's `Value`
builtins are priced at a default ~2^63 without the full cost model, so every
spend would overspend its budget.

To use a devnet you already have:

```bash
export PEBBLE_DEVNET=/path/to/.devnet/data
```

The nodes bind ports 37421 / 37793 / 37809, chosen so they do not collide with
the masterpiece devnet's.

---

## 1. Linear vesting

Funds vest *continuously* between `start` and `end` rather than unlocking in one
step:

```
vested(t) = total * (t - start) / (end - start)     clamped to [0, total]
```

The beneficiary may withdraw `vested(t) - claimed` at any point. A withdrawal
that leaves anything unvested must return the remainder to the script with
`claimed` increased by exactly the amount taken.

Worth reading for:

- **There is no "now" in a validator.** The transaction promises a validity
  interval and the script reads its **lower** bound: if the tx cannot be
  on-chain before `txEarliest`, at least that much time has certainly elapsed.
  The beneficiary can always understate it, never overstate it.
- **`claimed` lives in the datum, not in the balance.** Deriving it from the
  remaining balance would let anyone top the UTxO up to inflate the apparent
  entitlement.
- **Destructuring `Finite` rejects an open bound.** A tx whose lower bound is
  `-inf` proves nothing about elapsed time, and the destructure fails.
- Integer division truncates, which rounds vesting **down** — in favour of the
  contract. The final claim is still exact, because past `end` the clamp yields
  `total`.

What the e2e proves (`npm run e2e:vesting`): a partial claim mid-window
succeeds and writes the correct continuation datum; **an over-claim is
rejected**; the remainder is claimable once the window closes.

## 2. Two-party escrow

A buyer locks `price` lovelace for a named seller. Three outcomes, one endpoint
each: `accept` (seller takes payment, before the deadline), `refund` (buyer
reclaims, after the deadline), and `settle` (both sign, any split, any time).

Worth reading for:

- **Counterparties are `param`s, not datum fields**, so the script address
  itself is proof of who the parties are.
- **Each endpoint reads the bound that cannot be gamed.** `accept` needs "the
  deadline has not passed", so it reads the **upper** bound; `refund` needs "the
  deadline has passed", so it reads the **lower** one. Reading the convenient
  bound in either case would let a counterparty pick a wide interval and satisfy
  both branches at once.
- **Double-satisfaction defence.** The payment output is tagged with the spent
  escrow's own `TxOutRef` — unique by construction — so one payment can never
  discharge two escrows. The script also requires exactly one input at its own
  payment credential.
- **The bare `spend recover()` fallback.** Value sent here with a malformed
  datum belongs to nobody the script can identify, so it is left claimable
  rather than stranded forever.

What the e2e proves (`npm run e2e:escrow`): accept before the deadline succeeds
and **refund before it is rejected**; after the deadline refund succeeds and
**accept is rejected**; mutual settlement splits the funds.

## Advanced: the-cardano-masterpiece

A symlink to a separate repository — a live, **mainnet-deployed** project of
three interacting validators. It is not a tutorial; read it for the one thing a
single validator cannot demonstrate: **how contracts compose.**

- **Parameterisation by another script's hash** — `masterpiece.pebble` takes
  `param stewardshipContractHash: bytes`, binding the two validators at deploy
  time.
- **Cross-script authorisation via reference inputs** —
  `masterpiece.pebble` (`LeafNode.edit`) requires, for every rectangle edited, a
  Stewardship deed NFT in a **reference input** whose pub-key holder signed the
  transaction. That proves a right issued by a *different* contract without
  spending it, and deliberately excludes script-held deeds.
- **One transaction satisfying two validators** — `Marketplace.partialBuy`
  requires the tx to also run Stewardship's `carve` mint, and pins which carve
  runs.

Everything else in it — on-chain IPFS CIDv1 framing, guillotine rectangle
geometry — is domain detail, not Pebble technique.

---

## Layout

```
examples/
├── _shared/devnet.ts        buildooor + cardano-cli glue (query, submit, fund, wallets)
├── devnet/                  3-node PV11 devnet bootstrap
├── linear-vesting/
│   ├── src/index.pebble     the validator
│   └── offchain/
│       ├── vesting.ts       datum/redeemer encoders + tx builders
│       └── e2e.ts           the runnable devnet flow
├── two-party-escrow/        same shape
└── the-cardano-masterpiece  → symlink
```

### Datum and redeemer encodings

These are positional and must stay in step with the `.pebble` source:

- **datum** — `Constr(<state index>, [fields…])`, states numbered in
  declaration order. Both examples have a single state, so it is `Constr(0, …)`.
- **spend redeemer** — `Constr(<endpoint index>, [args…])`, numbered **per
  state** in declaration order. Escrow's `Escrow` state gives
  `accept = 0`, `refund = 1`, `settle = 2`.
- **contract `param`s** — applied to the compiled program in declaration order.
  Scalars (`bytes`, `int`) must be applied as plain UPLC constants; wrapping
  them in `Data` type-checks offchain but miscompiles.
