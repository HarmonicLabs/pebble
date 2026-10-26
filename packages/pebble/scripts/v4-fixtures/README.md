# V4 encoding fixture generator

Generates `src/compiler/__tests__/fixtures/v4-data-encodings.json`: the
ACTUAL `Data` encodings of every `PlutusLedgerApi.V4` type, produced by
the released plutus-ledger-api itself (not by reading its source). The
`compiler.v4Prelude.test.ts` suite decodes these back through pebble's
V4 prelude types on the CEK machine.

Currently pinned to **plutus-ledger-api 1.71.0.0**, the version the public
Dijkstra-era testnet (Musashi) runs.

Re-run whenever upstream moves the V4 shapes (CIP-0118 is still
Proposed, and the encodings already changed twice: 1.68 to 1.69, and
1.69 to 1.71). Bump the plutus version bound in `v4dump.cabal` and the CHaP
index-state in `cabal.project` as needed; the index-state cannot be later
than the newest CHaP snapshot `cabal update` fetched.

```bash
# needs GHC 9.6.6+, cabal 3.10+, and the native crypto libraries that
# cardano-crypto-class links: libsodium, libsecp256k1, libblst >= 0.3.14
cabal update
cabal build -w ghc-9.6.6
cabal run -v0 -w ghc-9.6.6 v4dump | grep -v Resolving > fixtures.txt
# then convert the `name <hex>` lines into the JSON's "fixtures" object,
# and update its "generator" / "generated" fields
```

If the system `libblst` is older than 0.3.14, build a newer one into a
private prefix and point `PKG_CONFIG_PATH` at it:

```bash
git clone --depth 1 --branch v0.3.15 https://github.com/supranational/blst
( cd blst && ./build.sh )
# install libblst.a, bindings/blst.h, bindings/blst_aux.h under a prefix,
# add a libblst.pc there, then:
export PKG_CONFIG_PATH=<prefix>/lib/pkgconfig:$PKG_CONFIG_PATH
```
