#!/usr/bin/env bash
# Puts each Plutus V4 feature on chain on Musashi (network magic 164), with
# the V4Features script (../out/v4-features.plutus) as the script that runs.
#
#   export CARDANO_CLI=... CARDANO_NODE_SOCKET_PATH=... \
#          PAYMENT_SKEY=... PAYMENT_VKEY=... STAKE_SKEY=... STAKE_VKEY=... PPARAMS=...
#   ./run.sh register      # certifying: register the script account (+ a key account)
#   ./run.sh mint          # minting
#   ./run.sh withdraw      # withdrawing: zero withdrawal from the script account
#   ./run.sh nested        # CIP-0118 sub-transaction: nested spend, sub-transaction
#                          # guard, required top-level guard
#   ./run.sh accounts      # direct deposit + account balance interval (see README)
#   ./run.sh batch-guard   # CIP-0112 script guard of a top-level transaction,
#                          # which sees the whole batch (see README)
#
# Every step waits for its transaction to be on chain and prints its id.
set -euo pipefail
cd "$( dirname "$0" )"
C="${CARDANO_CLI:-cardano-cli}"; MAGIC=164
SCRIPT=../out/v4-features.plutus
SCRIPT_HASH=$( $C dijkstra transaction policyid --script-file $SCRIPT )
SCRIPT_ADDR=$( $C dijkstra address build --payment-script-file $SCRIPT --testnet-magic $MAGIC )
SCRIPT_ACCOUNT=$( $C dijkstra stake-address build --stake-script-file $SCRIPT --testnet-magic $MAGIC )
ADDR=$( $C dijkstra address build --payment-verification-key-file "$PAYMENT_VKEY" --testnet-magic $MAGIC )
PKH=$( $C dijkstra address key-hash --payment-verification-key-file "$PAYMENT_VKEY" )
STAKE_HASH=$( $C dijkstra stake-address key-hash --stake-verification-key-file "$STAKE_VKEY" )
# generous execution budgets for build-raw: the script needs well under 1%
# of them, and the ledger only requires the declared units to cover the run
UNITS="(1000000000, 2000000)"
mkdir -p tx

# pure-ADA wallet UTxOs, largest first: [0] pays, [1] is collateral
wallet() { $C dijkstra query utxo --address "$ADDR" --testnet-magic $MAGIC --output-json \
    | jq -r 'to_entries | map(select(.value.value | length == 1)) | sort_by(-.value.value.lovelace) | .[] | "\(.key) \(.value.value.lovelace)"'; }
fund()       { wallet | sed -n 1p | cut -d' ' -f1; }
fund_value() { wallet | sed -n 1p | cut -d' ' -f2; }
coll()       { wallet | sed -n 2p | cut -d' ' -f1; }
coll_value() { wallet | sed -n 2p | cut -d' ' -f2; }
txid() { $C dijkstra transaction txid --tx-file "$1" | jq -r .txhash; }
submit() {   # $1 = signed tx file; waits until its first output is on chain
    local id; id=$( txid "$1" )
    # (runs inside $( ): a failure has to stop the script explicitly)
    $C dijkstra transaction submit --tx-file "$1" --testnet-magic $MAGIC >&2 || exit 1
    until $C dijkstra query utxo --tx-in "$id#0" --testnet-magic $MAGIC --output-json | jq -e 'length > 0' >/dev/null; do sleep 5; done
    echo "$id"
}
sign() { $C dijkstra transaction sign --tx-file "$1" --testnet-magic $MAGIC --out-file "$2" "${@:3}"; }
# redeemers and datums go through files: cardano-cli reads `--*-value` JSON
# without a schema, which would turn {"constructor":…} into a map
redeemer() { local f="tx/redeemer-$1.json"; printf '{"constructor":%s,"fields":[%s]}\n' "$1" "${2:-}" > "$f"; echo "$f"; }
unit_datum() { echo '{"constructor":0,"fields":[]}' > tx/unit-datum.json; echo tx/unit-datum.json; }
keyCredential() { printf '{"constructor":0,"fields":[{"bytes":"%s"}]}' "$1"; }

case "${1:-}" in
register)
    $C dijkstra stake-address registration-certificate --stake-script-file $SCRIPT \
        --key-reg-deposit-amt 2000000 --out-file tx/reg-script-account.cert
    $C dijkstra stake-address registration-certificate --stake-verification-key-file "$STAKE_VKEY" \
        --key-reg-deposit-amt 2000000 --out-file tx/reg-key-account.cert
    $C dijkstra transaction build --testnet-magic $MAGIC \
        --tx-in "$( fund )" --tx-in-collateral "$( coll )" \
        --certificate-file tx/reg-script-account.cert --certificate-script-file $SCRIPT \
        --certificate-redeemer-file "$( redeemer 4 )" \
        --certificate-file tx/reg-key-account.cert \
        --change-address "$ADDR" --out-file tx/register.raw >/dev/null
    sign tx/register.raw tx/register.signed --signing-key-file "$PAYMENT_SKEY" --signing-key-file "$STAKE_SKEY"
    echo "register: $( submit tx/register.signed )"
    ;;
mint)
    $C dijkstra transaction build --testnet-magic $MAGIC \
        --tx-in "$( fund )" --tx-in-collateral "$( coll )" \
        --mint "1 $SCRIPT_HASH.7634" --mint-script-file $SCRIPT --mint-redeemer-file "$( redeemer 1 )" \
        --tx-out "$ADDR+2000000+1 $SCRIPT_HASH.7634" \
        --change-address "$ADDR" --out-file tx/mint.raw >/dev/null
    sign tx/mint.raw tx/mint.signed --signing-key-file "$PAYMENT_SKEY"
    echo "mint: $( submit tx/mint.signed )"
    ;;
withdraw)
    $C dijkstra transaction build --testnet-magic $MAGIC \
        --tx-in "$( fund )" --tx-in-collateral "$( coll )" \
        --withdrawal "$SCRIPT_ACCOUNT+0" --withdrawal-script-file $SCRIPT \
        --withdrawal-redeemer-file "$( redeemer 2 )" \
        --change-address "$ADDR" --out-file tx/withdraw.raw >/dev/null
    sign tx/withdraw.raw tx/withdraw.signed --signing-key-file "$PAYMENT_SKEY"
    echo "withdraw: $( submit tx/withdraw.signed )"
    ;;
nested)
    # 1. a UTxO at the script address, spent later inside the sub-transaction
    #    (reused if an earlier run already created it)
    if [ -f tx/nested-lock.signed ] && $C dijkstra query utxo --tx-in "$( txid tx/nested-lock.signed )#0" \
            --testnet-magic $MAGIC --output-json | jq -e 'length > 0' >/dev/null; then
        LOCK=$( txid tx/nested-lock.signed ); echo "nested-lock: $LOCK (existing)"
    else
    $C dijkstra transaction build --testnet-magic $MAGIC \
        --tx-in "$( fund )" \
        --tx-out "$SCRIPT_ADDR+10000000" --tx-out-inline-datum-file "$( unit_datum )" \
        --change-address "$ADDR" --out-file tx/nested-lock.raw >/dev/null
    sign tx/nested-lock.raw tx/nested-lock.signed --signing-key-file "$PAYMENT_SKEY"
    LOCK=$( submit tx/nested-lock.signed ); echo "nested-lock: $LOCK"
    fi
    # 2. the sub-transaction: spends it (`nested spend inSubTx`), is guarded by
    #    the script (`nested guard subTxGuard`), and requires the payment key
    #    as a guard of the top-level transaction
    $C dijkstra sub-transaction build-raw \
        --tx-in "$LOCK#0" --tx-in-script-file $SCRIPT --tx-in-inline-datum-present \
        --tx-in-redeemer-file "$( redeemer 0 "$( keyCredential $PKH )" )" --tx-in-execution-units "$UNITS" \
        --tx-out "$ADDR+10000000" \
        --guard-script-file $SCRIPT --guard-redeemer-file "$( redeemer 5 )" --guard-execution-units "$UNITS" \
        --top-level-guard-key-hash "$PKH" \
        --protocol-params-file "$PPARAMS" --out-file tx/nested-sub.raw
    $C dijkstra sub-transaction sign --sub-tx-file tx/nested-sub.raw --out-file tx/nested-sub.signed \
        --signing-key-file "$PAYMENT_SKEY"
    # 3. the top-level transaction: embeds it, pays the fee, and carries the
    #    payment key as its guard
    FEE=1500000; F=$( fund ); FV=$( fund_value ); CL=$( coll ); CV=$( coll_value )
    $C dijkstra transaction build-raw \
        --tx-in "$F" --tx-out "$ADDR+$(( FV - FEE ))" --fee $FEE \
        --tx-in-collateral "$CL" --tx-total-collateral 3000000 --tx-out-return-collateral "$ADDR+$(( CV - 3000000 ))" \
        --signed-sub-tx-file tx/nested-sub.signed --required-signer-hash "$PKH" \
        --protocol-params-file "$PPARAMS" --out-file tx/nested.raw
    sign tx/nested.raw tx/nested.signed --signing-key-file "$PAYMENT_SKEY"
    echo "nested: $( submit tx/nested.signed )"
    ;;
accounts)
    # Zero withdrawal from the script account (`observeAccounts`), plus a
    # direct deposit of 1 ADA into the key account and a balance interval
    # [0, 1 ADA) on the script account. cardano-cli has no options for the
    # last two, so they are added to the built body by add-body-fields.py.
    FEE=1000000; DEPOSIT=1000000; F=$( fund ); FV=$( fund_value ); CL=$( coll ); CV=$( coll_value )
    $C dijkstra transaction build-raw \
        --tx-in "$F" --tx-out "$ADDR+$(( FV - FEE - DEPOSIT ))" --fee $FEE \
        --tx-in-collateral "$CL" --tx-total-collateral 2000000 --tx-out-return-collateral "$ADDR+$(( CV - 2000000 ))" \
        --withdrawal "$SCRIPT_ACCOUNT+0" --withdrawal-script-file $SCRIPT \
        --withdrawal-redeemer-file "$( redeemer 3 "$( keyCredential $STAKE_HASH ),{\"int\":$DEPOSIT}" )" \
        --withdrawal-execution-units "$UNITS" \
        --protocol-params-file "$PPARAMS" --out-file tx/accounts.cli.raw
    python3 -I add-body-fields.py tx/accounts.cli.raw tx/accounts.raw \
        --direct-deposit "e0$STAKE_HASH:$DEPOSIT" \
        --account-balance-interval "f0$SCRIPT_HASH:0:$DEPOSIT"
    sign tx/accounts.raw tx/accounts.signed --signing-key-file "$PAYMENT_SKEY"
    echo "accounts: $( submit tx/accounts.signed )"
    ;;
batch-guard)
    # A batch whose top-level transaction is guarded by the script
    # (`guard batchGuard`), which sees the whole batch through TopTxInfo.
    # 1. the sub-transaction: moves a wallet UTxO back to the wallet and
    #    requires the script as a guard of the top-level transaction (a
    #    Plutus script guard must carry a datum there; key guards must not)
    S_IN=$( wallet | sed -n 3p | cut -d' ' -f1 ); S_V=$( wallet | sed -n 3p | cut -d' ' -f2 )
    $C dijkstra sub-transaction build-raw \
        --tx-in "$S_IN" --tx-out "$ADDR+$S_V" \
        --top-level-guard-script-hash "$SCRIPT_HASH" --top-level-guard-datum-file "$( unit_datum )" \
        --out-file tx/batch-sub.raw
    $C dijkstra sub-transaction sign --sub-tx-file tx/batch-sub.raw --out-file tx/batch-sub.signed \
        --signing-key-file "$PAYMENT_SKEY"
    # 2. the template: a sub-transaction that carries the script guard with
    #    the top-level redeemer; never submitted (see copy-guard-witness.py)
    $C dijkstra sub-transaction build-raw \
        --tx-in "$S_IN" --tx-out "$ADDR+$S_V" \
        --guard-script-file $SCRIPT --guard-redeemer-file "$( redeemer 6 '{"int":1}' )" \
        --guard-execution-units "$UNITS" \
        --protocol-params-file "$PPARAMS" --out-file tx/batch-guard-template.raw
    # 3. the top-level transaction: embeds the sub-transaction and pays the
    #    fee, then receives the script guard from the template
    FEE=2000000; F=$( fund ); FV=$( fund_value ); CL=$( coll ); CV=$( coll_value )
    $C dijkstra transaction build-raw \
        --tx-in "$F" --tx-out "$ADDR+$(( FV - FEE ))" --fee $FEE \
        --tx-in-collateral "$CL" --tx-total-collateral 3000000 --tx-out-return-collateral "$ADDR+$(( CV - 3000000 ))" \
        --signed-sub-tx-file tx/batch-sub.signed \
        --out-file tx/batch.cli.raw
    python3 -I copy-guard-witness.py tx/batch.cli.raw tx/batch-guard-template.raw tx/batch.raw
    sign tx/batch.raw tx/batch.signed --signing-key-file "$PAYMENT_SKEY"
    echo "batch-guard: $( submit tx/batch.signed )"
    ;;
*) echo "usage: $0 register | mint | withdraw | nested | accounts | batch-guard" >&2; exit 2 ;;
esac
