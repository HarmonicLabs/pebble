import { compile, scriptToJsonFormat } from "../compile"
import { PScriptContext } from "../../API/V1/ScriptContext/PScriptContext"
import { PTxInInfo } from "../../API/V1/Tx/PTxInInfo"
import { makeValidator } from "../makeScript"
import { PTxInfo } from "../../API/V1/ScriptContext/PTxInfo/PTxInfo"
import { PScriptPurpose } from "../../API/V1/ScriptContext/PScriptPurpose"
import { PTxOutRef } from "../../API/V1/Tx/PTxOutRef"
import { PTxId } from "../../API/V1/Tx/PTxId"
import { PDatumHash } from "../../API/V1/ScriptsHashes/PDatumHash"
import { PDCert } from "../../API/V1/PDCert"
import { PValue } from "../../API/V1/Value/PValue"
import { PBound } from "../../API/V1/Interval/PBound"
import { PExtended } from "../../API/V1/Interval/PExtended"
import { PBound } from "../../API/V1/Interval/PBound"
import { PPubKeyHash } from "../../API/V1/PubKey/PPubKeyHash"
import { PStakingCredential } from "../../API/V1/Address/PStakingCredential"
import { PTxOut } from "../../API/V1/Tx/PTxOut"
import { PAddress } from "../../API/V1/Address/PAddress"
import { PCredential } from "../../API/V1/Address/PCredential"
import { PValidatorHash } from "../../API/V1/ScriptsHashes/PValidatorHash"
import { pfn, pif, punBData, perror, plet, pevery, plam, pfilter, peqBs, PMaybe, papp, pBSToData, pBool, pByteString, pInt, pList, pmakeUnit, fromData, toData } from "../../lib"
import { bool, bs, data, fn, int, pair, unit } from "../../type_system"
import { Term, PPOSIXTimeRange, PValueEntryT } from "../.."
import { ByteString } from "@harmoniclabs/bytestring"
import { DataConstr } from "@harmoniclabs/plutus-data"
import { evalScript } from "@harmoniclabs/plutus-machine"
import { showUPLC, UPLCConst } from "@harmoniclabs/uplc"


describe.skip("scriptToJsonFormat", () => {

    test.skip("Cardano <3 plu-ts", () => {

        const correctBS = ByteString.fromAscii( "Cardano <3 plu-ts" );

        const contract = pfn([
            data,
            data,
            data
        ],  unit
        )(
            ( _datum, redeemerBS, _ctx ) => {

                return pif( unit ).$(
                    pByteString(
                        correctBS
                    ).eq( punBData.$( redeemerBS ) )
                )
                .then( pmakeUnit() )
                .else( perror( unit, "wrong BS" ) )
            }
        );

        console.log(
            showUPLC(
                contract.toUPLC(0)
            )
        );

        console.log(
            JSON.stringify(
                scriptToJsonFormat(
                    compile( contract ),
                    "PlutusScriptV1"
                )
            )
        );

    });
    

    test.only("Cardano <3 plu-ts; unit Datum", () => {

        const label = "SC generation and compilation";
        console.time( label );

        const correctBS = ByteString.fromAscii( "Cardano <3 plu-ts" );
        
        const contract = pfn([
            data,
            bs,
            PScriptContext.type
        ],  bool
        )(
            ( _datum, redeemerBS, ctx ) => {

                return pByteString( correctBS ).eq( redeemerBS )
                    .and(
                        ctx.extract("purpose","tx").in( ({purpose,tx}) =>

                        // @ts-ignore
                            plet( pownHash.$( tx ).$( purpose ) ).in( ownHash =>

                                tx.extract("outputs","inputs").in( ({ outputs }) =>

                                    pevery( PTxOut.type )
                                    .$( plam( PTxOut.type, bool )(
                                        txOutToSelf =>
                                            txOutToSelf.extract("datumHash").in( ({datumHash}) =>
                                                pmatch( datumHash )
                                                .onJust( _ =>       pBool( true  ) )
                                                .onNothing( _ =>    pBool( false ) )
                                            )
                                    ))
                                    .$(
                                        pfilter( PTxOut.type )
                                        .$( plam( PTxOut.type, bool )(
                                            (resolved) =>
                                                resolved.extract("address").in( ({ address }) => 
                                                    address.extract("credential").in( ({ credential }) =>
                                                        pmatch( credential )
                                                        .onPScriptCredential( rawScriptCredFields => rawScriptCredFields.extract("valHash").in( ({ valHash }) => {
                                                            
                                                            return peqBs.$( ownHash ).$( valHash )
                                                        }))
                                                        .onPPubKeyCredential( _ => pBool( false ) )
                                                    )
                                                )
                                        ))
                                        .$( outputs )
                                    )
                                )
                            )
                        )
                    );
            }
        );

        const validator = makeValidator( contract );
        const compiled = compile( validator );

        console.timeEnd( label );
        console.log( `${compiled.length} bytes` );

        /*
        console.log(
            JSON.stringify(
                scriptToJsonFormat(
                    compiled,
                    PlutusScriptVersion.V1
                )
            )
        );
        //*/

        const validatorUPLC = validator.toUPLC(0);

        /*
        const deserialized = UPLCDecoder.parse(
            compiled,
            "flat"
        );

        const deserializedUPLCText = showUPLC(
            deserialized.body
        );

        const validatorUPLCText = showUPLC(
            validatorUPLC
        );

        expect(
            deserializedUPLCText
        ).toEqual(
            validatorUPLCText
        );
        //*/
        
        const dataCreationTimeTag = "creation of ScriptContext";
        console.time(dataCreationTimeTag);
        //*
        const unitDatumHash = PDatumHash.from( pByteString("923918e403bf43c34b4ef6b48eb2ee04babed17320d8d1b9ff9ad086e86f44ec") );
        const unitDatumHashAsData = toData( PDatumHash.type )( unitDatumHash );
        const justUnitDatumHash = PMaybe( PDatumHash.type ).Just({ val: unitDatumHashAsData });
        const emptyValue = PValue.from( pList( PValueEntryT )([]) as any );

        const validatorSpendingUtxo = PTxOutRef.PTxOutRef({
            id: PTxId.PTxId({
                txId: pByteString("deadbeef")
            }),
            index: pInt( 0 )
        });
        const validatorAddr = PAddress.PAddress({
            credential: PCredential.PScriptCredential({
                valHash: PValidatorHash.from( pByteString("caffee") )
            }),
            stakingCredential: PMaybe( PStakingCredential.type ).Nothing({})
        });
        const reslovedValidatorOutput = PTxOut.PTxOut({
            address: validatorAddr,
            datumHash: justUnitDatumHash,
            value: emptyValue
        });

        const appliedDeserialized = papp(
            papp(
                papp(
                    new Term(
                        fn([data, data, data], unit),
                        _dbn => validatorUPLC
                    ) as any,
                    new Term(
                        data,
                        _dbn => UPLCConst.data(new DataConstr( 0, []))
                    ) as any
                ) as any,
                pBSToData.$(pByteString( correctBS ))
            ) as any,
            PScriptContext.PScriptContext({
                tx: PTxInfo.PTxInfo({
                    datums: pList( pair( PDatumHash.type, data ) )([]),
                    dCertificates: pList( PDCert.type )([]),
                    fee: emptyValue,
                    mint: emptyValue,
                    id: PTxId.PTxId({
                        txId: pByteString("deadbeef")
                    }),
                    interval: PPOSIXTimeRange.PInterval({
                        from: PBound.PBound({
                            bound: PExtended.PNegInf({}),
                            inclusive: pBool( false )
                        }),
                        to: PBound.PBound({
                            bound: PExtended.PPosInf({}),
                            inclusive: pBool( false )
                        })
                    }),
                    signatories: pList( PPubKeyHash.type )([]),
                    withdrawals: pList( pair( PStakingCredential.type, int ) )([]),
                    inputs: pList( PTxInInfo.type )([
                        PTxInInfo.PTxInInfo({
                            utxoRef: validatorSpendingUtxo,
                            resolved: reslovedValidatorOutput
                        })
                    ]),
                    outputs: pList( PTxOut.type )([ reslovedValidatorOutput ])
                }),
                purpose: PScriptPurpose.Spending({
                    utxoRef: validatorSpendingUtxo
                })
            })
        );

        console.timeEnd(dataCreationTimeTag);

        expect(
            evalScript(
                appliedDeserialized.toUPLC(0)
            )
        ).toEqual(
            UPLCConst.unit
        );

        /*
        const appliedContract = contract
        .$( new Term(
            data,
            _dbn => UPLCConst.data(new DataConstr( 0, []))
        ))
        .$( pByteString( correctBS ) )
        .$( PScriptContext.PScriptContext({
            tx: PTxInfo.PTxInfo({
                datums: pList( pair( PDatumHash.type, data ) )([]),
                dCertificates: pList( PDCert.type )([]),
                fee: emptyValue,
                mint: emptyValue,
                id: PTxId.PTxId({
                    txId: pByteString("deadbeef")
                }),
                interval: PPOSIXTimeRange.PInterval({
                    from: PBound( PPOSIXTime.type ).PBound({
                        bound: PExtended( PPOSIXTime.type ).PNegInf({}),
                        inclusive: pBool( false )
                    }),
                    to: PBound( PPOSIXTime.type ).PBound({
                        bound: PExtended( PPOSIXTime.type ).PPosInf({}),
                        inclusive: pBool( false )
                    })
                }),
                signatories: pList( PPubKeyHash.type )([]),
                withdrawals: pList( pair( PStakingCredential.type, int ) )([]),
                inputs: pList( PTxInInfo.type )([
                    PTxInInfo.PTxInInfo({
                        outRef: validatorSpendingUtxo,
                        resolved: PTxOut.PTxOut({
                            address: PAddress.PAddress({
                                credential: PCredential.PScriptCredential({
                                    valHash: PValidatorHash.from( pByteString("caffee") )
                                }),
                                stakingCredential: PMaybe( PStakingCredential.type ).Nothing({})
                            }),
                            datumHash: PMaybe( PDatumHash.type ).Just({ val: unitDatumHash }),
                            value: emptyValue
                        })
                    })
                ]),
                outputs: pList( PTxOut.type )([])
            }),
            purpose: PScriptPurpose.Spending({
                utxoRef: validatorSpendingUtxo
            })
        }) );

        const appliedContractUPLC = appliedContract.toUPLC(0);

        /*
        console.log(
            evalScript(
                appliedContractUPLC
            )
        )
        //*/

    })

})