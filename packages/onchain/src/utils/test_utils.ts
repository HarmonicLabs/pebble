import {
    PDatumHash,
    pByteString,
    PValue,
    pList,
    toData,
    PTxOutRef,
    PTxId,
    bs,
    pDataI,
    pPair,
    PCurrencySymbol,
    list,
    PTokenName,
    int,
    pInt,
    V1,
    map,
    data,
    pair,
    PDCert,
    PPOSIXTimeRange,
    PBound,
    PExtended,
    bool,
    pBool,
    PBound,
    PPubKeyHash,
    PStakingCredential,
    PAddress,
    PCredential,
    PValidatorHash,
    PMaybe,
    PScriptPurpose,
    PTxInfo,
    POutputDatum,
    PTxOut,
    addUtilityForType,
    V2,
    PValueEntry,
    PAssetsEntry
} from "../pluts";

export const unitDatumHash = PDatumHash.from( pByteString("923918e403bf43c34b4ef6b48eb2ee04babed17320d8d1b9ff9ad086e86f44ec") );
export const emptyValue = PValue.from( pList( PValueEntry.type )([]) as any );

export const emptyValueAsData = toData( PValue.type )( emptyValue );

export const validatorSpendingUtxo = PTxOutRef.PTxOutRef({
    id: toData( PTxId.type )(
        PTxId.PTxId({
            txId: toData( bs )( pByteString("deadbeef") )
        })
    ),
    index: pDataI( 0 )
});

export const validatorSpendingUtxoAsData = toData( PTxOutRef.type )( validatorSpendingUtxo );

export const beef32 = PValue.from(
    pList( PValueEntry.type )([
        PValueEntry.from([
            PCurrencySymbol.from( pByteString("deadbeef") ),
            pList( PAssetsEntry.type )([
                PAssetsEntry.from([
                    PTokenName.from( pByteString("beef") ),
                    pInt( 32 )
                ])
            ])
        ])
    ])
);

export const beef32AsData = toData( PValue.type )( beef32 );

export const datums = toData( map( PDatumHash.type, data ) )
(
    pList( pair( PDatumHash.type, data ) )([])
);

export const dCertificates = toData( list( PDCert.type ) )
(
    pList( PDCert.type )([])
);

export const txId = toData( PTxId.type )(
    PTxId.PTxId({
        txId: toData( bs )( pByteString("deadbeef") )
    })
);

export const interval = toData( PPOSIXTimeRange.type )(
    PPOSIXTimeRange.PInterval({
        from: toData( PBound.type )(
            PBound.PBound({
                bound: toData( PExtended.type )( PExtended.PFinite({ _0: pDataI(1) }) ),
                inclusive: toData( bool )( pBool( false ) )
            })
        ),
        to: toData( PBound.type )(
            PBound.PBound({
                bound: toData( PExtended.type )( PExtended.PPosInf({}) ),
                inclusive: toData( bool )( pBool( false ) )
            })
        )
    })
);

export const signatories = toData( list( PPubKeyHash.type ) )( pList( PPubKeyHash.type )([
    PPubKeyHash.from("deadbeef")
]) );

export const withdrawals = 
    toData( map( PStakingCredential.type,int ) )( 
        pList( pair( PStakingCredential.type, int ) )([])
    );

export const address = toData( PAddress.type )(
    PAddress.PAddress({
        credential: PCredential.PScriptCredential({
            valHash: toData( PValidatorHash.type )( PValidatorHash.from( pByteString("caffee") ) )
        }) as any,
        stakingCredential: PMaybe( PStakingCredential.type ).Nothing({}) as any
    })
);

export const inputs = toData( list( V1.PTxInInfo.type ) )(
    pList( V1.PTxInInfo.type )([
        V1.PTxInInfo.PTxInInfo({
            utxoRef: validatorSpendingUtxoAsData,
            resolved: toData( V1.PTxOut.type )(
                V1.PTxOut.PTxOut({
                    address,
                    datumHash: PMaybe( PDatumHash.type ).Just({ val: toData( PDatumHash.type )(unitDatumHash) }) as any,
                    value: beef32AsData as any
                })
            )
        })
    ])
)

export const outputs = toData( list( V1.PTxOut.type ) )(
    pList( V1.PTxOut.type )([])
);

export const txInfo_v1 = V1.PTxInfo.PTxInfo({
    datums,
    dCertificates,
    fee:  emptyValueAsData as any,
    mint: emptyValueAsData as any,
    id: txId,
    interval,
    signatories,
    withdrawals,
    inputs,
    outputs
});

export const _purp = PScriptPurpose.Spending({
    utxoRef: validatorSpendingUtxoAsData
});

export const ctx = V1.PScriptContext.PScriptContext({
    tx: toData( V1.PTxInfo.type )( txInfo_v1 ),
    purpose: toData( PScriptPurpose.type )( _purp )
});

export const v2_out = toData( PTxOut.type )
(
    V2.PTxOut.PTxOut({
        address,
        value: beef32AsData as any,
        datum: POutputDatum.NoDatum({}) as any,
        refScrpt: PMaybe( PValidatorHash.type ).Nothing({}) as any
    })
)

export const v2_inputs = toData( list( V2.PTxInInfo.type ) )
(
    pList( V2.PTxInInfo.type )([
        V2.PTxInInfo.PTxInInfo({
            utxoRef: validatorSpendingUtxoAsData,
            resolved: v2_out
        })
    ])
)

export const empty_v2_outs = toData( list(V2.PTxOut.type) )(
    pList( PTxOut.type )([])
);

export const empty_redeemers = toData( map( PScriptPurpose.type, data ) )(
    pList( pair( PScriptPurpose.type, data ) )([])
);

export const empty_refInputs = toData( list( V2.PTxInInfo.type ) )(
    pList( V2.PTxInInfo.type )([])
)

export const tx_v2 = addUtilityForType( PTxInfo.type )(

    PTxInfo.PTxInfo({
        datums,
        dCertificates,
        fee:  emptyValueAsData as any,
        mint: emptyValueAsData as any,
        id: txId,
        interval,
        signatories,
        withdrawals,
        inputs: v2_inputs,
        outputs: empty_v2_outs,
        redeemers: empty_redeemers,
        refInputs: empty_refInputs
    })
);