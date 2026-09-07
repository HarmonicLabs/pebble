{-# LANGUAGE OverloadedStrings #-}

-- Dump the ACTUAL PlutusLedgerApi.V4 Data encodings (plutus-ledger-api
-- 1.68.0.0) as hex-encoded CBOR, one `name <hex>` line each. These become
-- the golden fixtures pebble's V4 prelude types are validated against.
module Main where

import Codec.Serialise (serialise)
import Data.ByteString.Base16 qualified as B16
import Data.ByteString.Char8 qualified as BS8
import Data.ByteString.Lazy qualified as BSL

import PlutusLedgerApi.V1.Value qualified as V1V
import PlutusLedgerApi.V2 qualified as V2
import PlutusLedgerApi.V3 qualified as V3
import PlutusLedgerApi.V3.MintValue qualified as MV
import PlutusLedgerApi.V4 qualified as V4
import PlutusLedgerApi.V4.Time qualified as V4T
import PlutusLedgerApi.V4.Tx qualified as V4Tx
import PlutusTx qualified
import PlutusTx.AssocMap qualified as AMap

dump :: PlutusTx.ToData a => String -> a -> IO ()
dump name x =
  putStrLn $
    name
      <> " "
      <> BS8.unpack (B16.encode (BSL.toStrict (serialise (PlutusTx.toData x))))

-- distinctive sample atoms
pkhA, pkhB :: V2.PubKeyHash
pkhA = V2.PubKeyHash "\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170\170"
pkhB = V2.PubKeyHash "\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187\187"

sh1 :: V2.ScriptHash
sh1 = V2.ScriptHash "\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17\17"

txId3 :: V3.TxId
txId3 = V3.TxId "\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51\51"

credA, credS :: V2.Credential
credA = V2.PubKeyCredential pkhA
credS = V2.ScriptCredential sh1

accA :: V4.AccountId
accA = V4.AccountId credA

addrPk :: V4.Address
addrPk = V4.Address credA (Just accA)

addrNoStake :: V4.Address
addrNoStake = V4.Address credS Nothing

val :: V2.Value
val = V1V.singleton V1V.adaSymbol V1V.adaToken 75000000

ref :: V3.TxOutRef
ref = V3.TxOutRef txId3 5

outPk :: V4Tx.TxOut
outPk =
  V4Tx.TxOut
    { V4Tx.txOutAddress = addrPk
    , V4Tx.txOutValue = val
    , V4Tx.txOutDatum = V2.OutputDatum (V2.Datum (PlutusTx.toBuiltinData (42 :: Integer)))
    , V4Tx.txOutReferenceScript = Just sh1
    }

txIn :: V4.TxInInfo
txIn = V4.TxInInfo ref outPk

rng :: V4T.POSIXTimeRange
rng = V4T.POSIXTimeRange (Just 1000) (Just 2000)

delegatee :: V3.Delegatee
delegatee = V3.DelegVote V3.DRepAlwaysAbstain

certReg :: V4.TxCert
certReg = V4.TxCertRegAccount accA 2000000

purposeSpend :: V4.ScriptPurpose
purposeSpend = V4.Spending sh1 ref

govActionId :: V3.GovernanceActionId
govActionId = V3.GovernanceActionId txId3 7

proposal :: V3.ProposalProcedure
proposal = V3.ProposalProcedure 1000000 credA V3.InfoAction

txInfo :: V4.TxInfo
txInfo =
  V4.TxInfo
    { V4.txInfoId = txId3
    , V4.txInfoSubTxIx = Just 3
    , V4.txInfoInputs = [txIn]
    , V4.txInfoReferenceInputs = []
    , V4.txInfoOutputs = [outPk]
    , V4.txInfoMint = MV.emptyMintValue
    , V4.txInfoTxCerts = [certReg]
    , V4.txInfoWithdrawals = AMap.unsafeFromList [(credA, 9)]
    , V4.txInfoDirectDeposits = AMap.unsafeFromList [(credS, 11)]
    , V4.txInfoAccountBalanceIntervals =
        V4.AccountBalanceIntervals (AMap.unsafeFromList [(accA, V4.AccountBalanceExact 5000000)])
    , V4.txInfoValidRange = rng
    , V4.txInfoGuards = [credS]
    , V4.txInfoRequiredTopLevelGuards = AMap.unsafeFromList [(credS, Nothing)]
    , V4.txInfoRedeemers = AMap.unsafeFromList [(purposeSpend, V2.Redeemer (PlutusTx.toBuiltinData (0 :: Integer)))]
    , V4.txInfoData = AMap.unsafeFromList []
    , V4.txInfoVotes = AMap.unsafeFromList [(V3.DRepVoter (V3.DRepCredential credA), AMap.unsafeFromList [(govActionId, V3.VoteYes)])]
    , V4.txInfoProposalProcedures = [proposal]
    , V4.txInfoCurrentTreasuryAmount = Nothing
    , V4.txInfoTreasuryDonation = 17
    }

scriptInfoSpend :: V4.ScriptInfo
scriptInfoSpend = V4.SpendingScript ref (Just (V2.Datum (PlutusTx.toBuiltinData (99 :: Integer))))

ctx :: V4.ScriptContext
ctx =
  V4.ScriptContext
    { V4.scriptContextTxInfo = txInfo
    , V4.scriptContextRedeemer = V2.Redeemer (PlutusTx.toBuiltinData (0 :: Integer))
    , V4.scriptContextScriptInfo = scriptInfoSpend
    , V4.scriptContextScriptHash = sh1
    }

main :: IO ()
main = do
  -- atoms / leaf types
  dump "accountId" accA
  dump "address_with_account" addrPk
  dump "address_no_stake" addrNoStake
  dump "timerange_both" rng
  dump "timerange_open" (V4T.POSIXTimeRange Nothing Nothing)
  dump "txout" outPk
  dump "txin" txIn
  -- account balance intervals (all 4 constructors)
  dump "abi_lower" (V4.AccountBalanceLowerBound 1)
  dump "abi_upper" (V4.AccountBalanceUpperBound 2)
  dump "abi_both" (V4.AccountBalanceBothBounds 3 4)
  dump "abi_exact" (V4.AccountBalanceExact 5)
  -- certificates (all 11 constructors)
  dump "cert_reg_account" (V4.TxCertRegAccount accA 1)
  dump "cert_unreg_account" (V4.TxCertUnRegAccount accA 2)
  dump "cert_deleg_account" (V4.TxCertDelegAccount accA delegatee)
  dump "cert_reg_account_deleg" (V4.TxCertRegAccountDeleg accA delegatee 3)
  dump "cert_reg_drep" (V4.TxCertRegDRep (V3.DRepCredential credA) 4)
  dump "cert_update_drep" (V4.TxCertUpdateDRep (V3.DRepCredential credA))
  dump "cert_unreg_drep" (V4.TxCertUnRegDRep (V3.DRepCredential credA) 5)
  dump "cert_pool_register" (V4.TxCertPoolRegister pkhA pkhB)
  dump "cert_pool_retire" (V4.TxCertPoolRetire pkhA 6)
  dump "cert_auth_hot_committee" (V4.TxCertAuthHotCommittee (V3.ColdCommitteeCredential credA) (V3.HotCommitteeCredential credS))
  dump "cert_resign_cold_committee" (V4.TxCertResignColdCommittee (V3.ColdCommitteeCredential credA))
  -- script purposes (all 7 constructors)
  dump "purpose_minting" (V4.Minting sh1 (V1V.currencySymbol "\204\204"))
  dump "purpose_spending" purposeSpend
  dump "purpose_withdrawing" (V4.Withdrawing sh1 credA)
  dump "purpose_certifying" (V4.Certifying sh1 8 certReg)
  dump "purpose_voting" (V4.Voting sh1 (V3.DRepVoter (V3.DRepCredential credA)))
  dump "purpose_proposing" (V4.Proposing sh1 9 proposal)
  dump "purpose_guarding" (V4.Guarding sh1 10)
  -- script infos (all 7 constructors; Guard both with and without TopTxInfo)
  dump "scriptinfo_minting" (V4.MintingScript (V1V.currencySymbol "\204\204"))
  dump "scriptinfo_spending" scriptInfoSpend
  dump "scriptinfo_withdrawing" (V4.WithdrawingScript accA)
  dump "scriptinfo_certifying" (V4.CertifyingScript 11 certReg)
  dump "scriptinfo_voting" (V4.VotingScript (V3.DRepVoter (V3.DRepCredential credA)))
  dump "scriptinfo_proposing" (V4.ProposingScript 12 proposal)
  dump "scriptinfo_guarding_sub" (V4.GuardingScript 13 Nothing)
  dump
    "scriptinfo_guarding_top"
    ( V4.GuardingScript
        14
        ( Just
            ( V4.TopTxInfo
                { V4.topTxInfoSubTransactions = [txInfo]
                , V4.topTxInfoDatums = AMap.unsafeFromList [(txId3, V2.Datum (PlutusTx.toBuiltinData (7 :: Integer)))]
                , V4.topTxInfoStartingAccountBalanceIntervals = V4.AccountBalanceIntervals (AMap.unsafeFromList [])
                , V4.topTxInfoSimplified =
                    V4.TopTxInfoSimplified
                      { V4.ttisIds = [txId3]
                      , V4.ttisInputs = [txIn]
                      , V4.ttisReferenceInputs = []
                      , V4.ttisOutputs = [outPk]
                      , V4.ttisMints = MV.emptyMintValue
                      , V4.ttisBurns = MV.emptyMintValue
                      , V4.ttisTxCerts = [certReg]
                      , V4.ttisWithdrawals = AMap.unsafeFromList [(credA, 9)]
                      , V4.ttisDirectDeposits = AMap.unsafeFromList []
                      , V4.ttisValidRange = rng
                      , V4.ttisGuards = [credS]
                      , V4.ttisRequiredTopLevelGuards = [credS]
                      , V4.ttisScriptPurposes = [purposeSpend]
                      , V4.ttisData = AMap.unsafeFromList []
                      , V4.ttisVotes = AMap.unsafeFromList []
                      , V4.ttisProposalProcedures = []
                      , V4.ttisCurrentTreasuryAmount = Nothing
                      , V4.ttisTreasuryDonations = 21
                      }
                }
            )
        )
    )
  -- the aggregates
  dump "txinfo_full" txInfo
  dump "scriptcontext_full" ctx
