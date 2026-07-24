import { palias } from "../../../PTypes/PAlias/palias";
import { data, map } from "../../../type_system";

/**

{- | A Plutus Data object containing proposed parameter changes. The Data object contains
a @Map@ with one entry per changed parameter, from the parameter ID to the new value.
Unchanged parameters are not included.

The mapping from parameter IDs to parameters can be found in
[conway.cddl](https://github.com/IntersectMBO/cardano-ledger/blob/master/eras/conway/impl/cddl-files/conway.cddl).

/Invariant:/ This map is non-empty, and the keys are stored in ascending order.
-}

important note:

we can't really type this map because the values of each parameters are different

protocol_param_update =
  { ? 0:  coin                   ; minfee A
  , ? 1:  coin                   ; minfee B
  , ? 2:  uint .size 4           ; max block body size
  , ? 3:  uint .size 4           ; max transaction size
  , ? 4:  uint .size 2           ; max block header size
  , ? 5:  coin                   ; key deposit
  , ? 6:  coin                   ; pool deposit
  , ? 7:  epoch_interval         ; maximum epoch
  , ? 8:  uint .size 2           ; n_opt: desired number of stake pools
  , ? 9:  nonnegative_interval   ; pool pledge influence
  , ? 10: unit_interval          ; expansion rate
  , ? 11: unit_interval          ; treasury growth rate
  , ? 16: coin                   ; min pool cost
  , ? 17: coin                   ; ada per utxo byte
  , ? 18: costmdls               ; cost models for script languages
  , ? 19: ex_unit_prices         ; execution costs
  , ? 20: ex_units               ; max tx ex units
  , ? 21: ex_units               ; max block ex units
  , ? 22: uint .size 4           ; max value size
  , ? 23: uint .size 2           ; collateral percentage
  , ? 24: uint .size 2           ; max collateral inputs
  , ? 25: pool_voting_thresholds ; pool voting thresholds
  , ? 26: drep_voting_thresholds ; DRep voting thresholds
  , ? 27: uint .size 2           ; min committee size
  , ? 28: epoch_interval         ; committee term limit
  , ? 29: epoch_interval         ; governance action validity period
  , ? 30: coin                   ; governance action deposit
  , ? 31: coin                   ; DRep deposit
  , ? 32: epoch_interval         ; DRep inactivity period
  , ? 33: nonnegative_interval   ; MinFee RefScriptCostPerByte
  }
 */
export const PChangedParams = palias( map( data, data ) );