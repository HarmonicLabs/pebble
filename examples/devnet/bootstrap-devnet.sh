#!/usr/bin/env bash
# One-shot local devnet bring-up for the orderbook:
#   1. generate a cardano-testnet environment (keys / genesis / config / topology)
#   2. convert it to a PV11 / Dijkstra devnet and launch it (start-dijkstra.sh)
#   3. install the full 350-param PlutusV3 cost model via governance (update-costmodel.sh)
#
# After this, the node is at PV11 with a complete cost model and Pebble's
# Value/array builtins are usable.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
D="$ROOT/.devnet/data"
export CARDANO_CLI="${CARDANO_CLI:-$(command -v cardano-cli)}"
export CARDANO_NODE="${CARDANO_NODE:-$(command -v cardano-node)}"

echo "== step 1/3: generate a cardano-testnet environment =="
pkill -f cardano-testnet 2>/dev/null || true
ps aux | grep cardano-node | grep "$ROOT/.devnet" | grep -v grep | awk '{print $2}' | xargs -r kill 2>/dev/null || true
sleep 2
rm -rf "$D"
nohup env CARDANO_CLI="$CARDANO_CLI" CARDANO_NODE="$CARDANO_NODE" \
  cardano-testnet cardano --testnet-magic 42 --output-dir "$D" \
  > "$ROOT/.devnet/cardano-testnet.log" 2>&1 &
# wait until the env (keys + genesis) is fully written
for i in $(seq 1 60); do
  [ -f "$D/utxo-keys/utxo1/utxo.skey" ] && [ -f "$D/pools-keys/pool1/kes.skey" ] && break
  sleep 2
done
sleep 5   # let it write the rest of the env
echo "   environment generated under $D"

echo "== step 2/3: convert to PV11/Dijkstra and launch =="
bash "$ROOT/devnet/start-dijkstra.sh"

echo "== step 3/3: install full V3 cost model via governance =="
bash "$ROOT/devnet/update-costmodel.sh"

echo "== devnet ready =="
export CARDANO_NODE_SOCKET_PATH="$D/socket/node1/sock"
cardano-cli query protocol-parameters --testnet-magic 42 --out-file "$D/pparams.json"
node -e "const p=require('$D/pparams.json');console.log('PV',JSON.stringify(p.protocolVersion),'| V3 cost params',p.costModels.PlutusV3.length)"
