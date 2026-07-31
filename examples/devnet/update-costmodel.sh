#!/usr/bin/env bash
# Governance ParameterChange action to install the full PV11 PlutusV3 cost model
# (251 -> 350 params) so the new Value/array builtins (lookupCoin, unValueData,
# lengthOfArray, ...) are properly costed. Without this the node charges them a
# ~2^63 default cost and every spend overspends its budget.
#
# Empty committee (threshold 0 -> auto-approves) + 3 DReps with equal stake, so
# 3 yes votes clears the 0.5 DRep threshold. Short epochs (~50s) make enactment
# quick.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
D="$ROOT/.devnet/data"
export CARDANO_NODE_SOCKET_PATH="$D/socket/node1/sock"
MAGIC=42
W="$ROOT/.devnet/gov"; rm -rf "$W"; mkdir -p "$W"

GEN_SKEY="$D/utxo-keys/utxo1/utxo.skey"
GEN_ADDR=$(cat "$D/utxo-keys/utxo1/utxo.addr")

echo ">> building cost-model file (V1/V2 current, V3 = full 350-param model)"
node -e '
const fs=require("fs");
const B=require(process.argv[1]+"/node_modules/@harmoniclabs/buildooor");
const pp=JSON.parse(fs.readFileSync(process.argv[1]+"/.devnet/data/pparams.json"));
// the full current PlutusV3 cost model (350 params) bundled with buildooor
const def=B.defaultProtocolParameters.costModels.PlutusScriptV3;
const v3=B.costModelV3Keys.map(k=>Number(def[k]));
const cm={PlutusV1:pp.costModels.PlutusV1, PlutusV2:pp.costModels.PlutusV2, PlutusV3:v3};
fs.writeFileSync(process.argv[2]+"/costmodel.json", JSON.stringify(cm));
console.log("   V1",cm.PlutusV1.length,"V2",cm.PlutusV2.length,"V3",cm.PlutusV3.length);
' "$ROOT" "$W"

echo ">> anchor (served locally so cardano-cli can fetch + verify it)"
echo '{"body":{"title":"install full PV11 cost model"}}' > "$W/anchor.json"
AHASH=$(cardano-cli hash anchor-data --file-binary "$W/anchor.json")
( cd "$W" && python3 -m http.server 8899 >/dev/null 2>&1 & echo $! > "$W/httpd.pid" )
trap 'kill $(cat "$W/httpd.pid") 2>/dev/null || true' EXIT
sleep 1
AURL="http://127.0.0.1:8899/anchor.json"

echo ">> create the parameter-update action"
cardano-cli conway governance action create-protocol-parameters-update \
  --testnet \
  --governance-action-deposit 1000000 \
  --deposit-return-stake-verification-key-file "$D/stake-delegators/delegator1/staking.vkey" \
  --anchor-url "$AURL" --anchor-data-hash "$AHASH" \
  --cost-model-file "$W/costmodel.json" \
  --out-file "$W/action.gov"

echo ">> submit the action"
cardano-cli query utxo --address "$GEN_ADDR" --testnet-magic $MAGIC --out-file "$W/g.json"
GIN=$(node -e "console.log(Object.keys(require('$W/g.json'))[0])")
cardano-cli conway transaction build --testnet-magic $MAGIC \
  --tx-in "$GIN" --change-address "$GEN_ADDR" \
  --proposal-file "$W/action.gov" \
  --out-file "$W/act.raw"
cardano-cli conway transaction sign --testnet-magic $MAGIC --tx-body-file "$W/act.raw" \
  --signing-key-file "$GEN_SKEY" --out-file "$W/act.signed"
ACT_TXID=$(cardano-cli conway transaction txid --tx-file "$W/act.signed" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=d.trim();try{console.log(JSON.parse(s).txhash)}catch(e){console.log(s)}})")
cardano-cli conway transaction submit --testnet-magic $MAGIC --tx-file "$W/act.signed"
echo "   action tx: $ACT_TXID (index 0)"
sleep 5

echo ">> create + submit DRep yes votes"
VOTE_ARGS=()
SIGN_ARGS=(--signing-key-file "$GEN_SKEY")
for i in 1 2 3; do
  cardano-cli conway governance vote create --yes \
    --governance-action-tx-id "$ACT_TXID" --governance-action-index 0 \
    --drep-verification-key-file "$D/drep-keys/drep$i/drep.vkey" \
    --out-file "$W/vote$i.gov"
  VOTE_ARGS+=(--vote-file "$W/vote$i.gov")
  SIGN_ARGS+=(--signing-key-file "$D/drep-keys/drep$i/drep.skey")
done
cardano-cli query utxo --address "$GEN_ADDR" --testnet-magic $MAGIC --out-file "$W/g.json"
GIN2=$(node -e "console.log(Object.keys(require('$W/g.json'))[0])")
cardano-cli conway transaction build --testnet-magic $MAGIC \
  --tx-in "$GIN2" --change-address "$GEN_ADDR" \
  "${VOTE_ARGS[@]}" \
  --out-file "$W/votes.raw"
cardano-cli conway transaction sign --testnet-magic $MAGIC --tx-body-file "$W/votes.raw" \
  "${SIGN_ARGS[@]}" --out-file "$W/votes.signed"
cardano-cli conway transaction submit --testnet-magic $MAGIC --tx-file "$W/votes.signed"
echo "   votes submitted"

echo ">> waiting for ratification + enactment (epoch boundaries) ..."
for i in $(seq 1 40); do
  sleep 5
  cardano-cli query protocol-parameters --testnet-magic $MAGIC --out-file "$D/pparams.json" 2>/dev/null || true
  N=$(node -e "console.log(require('$D/pparams.json').costModels.PlutusV3.length)" 2>/dev/null || echo 251)
  EP=$(cardano-cli query tip --testnet-magic $MAGIC 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).epoch)}catch(e){console.log('?')}})")
  echo "   epoch $EP : V3 cost params = $N"
  [ "$N" -ge 350 ] && { echo ">> cost model updated to $N params"; break; }
done
