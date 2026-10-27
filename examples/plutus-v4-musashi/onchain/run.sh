#!/usr/bin/env bash
# Lock funds at the HashLockV4 script on Musashi (magic 164), then spend them.
#
#   CARDANO_CLI=... CARDANO_NODE_SOCKET_PATH=... PAYMENT_SKEY=... PAYMENT_ADDR=... ./run.sh lock
#   ... ./run.sh unlock
#   ... ./run.sh unlock-wrong-secret   # must FAIL script evaluation
#
# Prints every transaction id; the evidence is recorded in ./EVIDENCE.md.
set -euo pipefail
cd "$( dirname "$0" )"
C="${CARDANO_CLI:-cardano-cli}"; MAGIC=164
SCRIPT=../out/hash-lock-v4.plutus
SCRIPT_ADDR=$( $C dijkstra address build --payment-script-file $SCRIPT --testnet-magic $MAGIC )
SECRET_HEX=$( printf 'pebble-v4-on-musashi' | xxd -p | tr -d '\n' )
SECRET_HASH=$( printf 'pebble-v4-on-musashi' | sha256sum | cut -d' ' -f1 )
mkdir -p tx

wallet_utxo() { $C dijkstra query utxo --address "$PAYMENT_ADDR" --testnet-magic $MAGIC --output-json \
    | jq -r 'to_entries | map(select(.value.value | length == 1)) | sort_by(-.value.value.lovelace) | .[0].key'; }
script_utxo() { $C dijkstra query utxo --address "$SCRIPT_ADDR" --testnet-magic $MAGIC --output-json \
    | jq -r --arg h "$SECRET_HASH" 'to_entries | map(select(.value.inlineDatum.fields[0].bytes == $h)) | .[0].key'; }
now_posix_ms() {
    local start slot
    start=$( jq -r .systemStart "${SHELLEY_GENESIS:?}" ); slot=$( $C query tip --testnet-magic $MAGIC | jq -r .slot )
    echo $(( ( $( date -d "$start" +%s ) + slot ) * 1000 ))
}

case "${1:-}" in
lock)
    NOT_BEFORE=$( now_posix_ms )
    printf '{"constructor":0,"fields":[{"bytes":"%s"},{"int":%s}]}\n' "$SECRET_HASH" "$NOT_BEFORE" > tx/datum.json
    $C dijkstra transaction build --testnet-magic $MAGIC \
        --tx-in "$( wallet_utxo )" \
        --tx-out "$SCRIPT_ADDR+20000000" --tx-out-inline-datum-file tx/datum.json \
        --change-address "$PAYMENT_ADDR" --out-file tx/lock.raw
    $C dijkstra transaction sign --tx-body-file tx/lock.raw --signing-key-file "$PAYMENT_SKEY" --testnet-magic $MAGIC --out-file tx/lock.signed
    $C dijkstra transaction submit --tx-file tx/lock.signed --testnet-magic $MAGIC
    echo "lock txid: $( $C dijkstra transaction txid --tx-file tx/lock.signed | jq -r .txhash )"
    ;;
unlock|unlock-wrong-secret)
    S_HEX=$SECRET_HEX; [ "$1" = unlock-wrong-secret ] && S_HEX=$( printf 'wrong' | xxd -p )
    printf '{"constructor":0,"fields":[{"bytes":"%s"}]}\n' "$S_HEX" > tx/redeemer.json
    $C dijkstra transaction build --testnet-magic $MAGIC \
        --tx-in "$( script_utxo )" \
        --tx-in-script-file $SCRIPT --tx-in-inline-datum-present --tx-in-redeemer-file tx/redeemer.json \
        --tx-in-collateral "$( wallet_utxo )" \
        --invalid-before "$( $C query tip --testnet-magic $MAGIC | jq -r .slot )" \
        --change-address "$PAYMENT_ADDR" --out-file tx/$1.raw
    $C dijkstra transaction sign --tx-body-file tx/$1.raw --signing-key-file "$PAYMENT_SKEY" --testnet-magic $MAGIC --out-file tx/$1.signed
    $C dijkstra transaction submit --tx-file tx/$1.signed --testnet-magic $MAGIC
    echo "$1 txid: $( $C dijkstra transaction txid --tx-file tx/$1.signed | jq -r .txhash )"
    ;;
*) echo "usage: $0 lock | unlock | unlock-wrong-secret" >&2; exit 2 ;;
esac
