import { Data, DataConstr, DataI } from "@harmoniclabs/plutus-data";
import { GenesisInfos, NormalizedGenesisInfos, isGenesisInfos, isNormalizedGenesisInfos, normalizedGenesisInfos } from "../TxBuilder/GenesisInfos";
import { unsafeForceUInt } from "../utils/ints";

/**
 * 
 * @param POSIX POSIX time in milliseconds
 * @param sysStartPOSIX blockchain start POSIX time in milliseconds
 * @param slotLenMs milliseconds per slot
 * @returns 
 */
export function POSIXToSlot( unixTime: number, gInfos: NormalizedGenesisInfos ): number
{
    const timePassed = unixTime - gInfos.systemStartPosixMs;
    const slotsPassed = Math.floor(timePassed / gInfos.slotLengthMs);
    return slotsPassed + gInfos.startSlotNo;
}

/**
 * 
 * @param slotN number of the slot
 * @param sysStartPOSIX blockchain start POSIX time in milliseconds
 * @param slotLenMs milliseconds per slot
 * @returns 
 */
export function slotToPOSIX( slot: number, gInfos: NormalizedGenesisInfos ): number
{
    const msAfterBegin = (slot - gInfos.startSlotNo) * gInfos.slotLengthMs;
    return gInfos.systemStartPosixMs + msAfterBegin;
}

export function getTxIntervalData(
    startSlot: bigint | undefined,
    ttlSlot: bigint | undefined,
    geneisInfos: GenesisInfos | undefined
): DataConstr
{
    geneisInfos = geneisInfos ? normalizedGenesisInfos( geneisInfos ) : undefined;
    let lowerBoundData: Data | undefined = undefined;

    if( startSlot === undefined )
    {
        lowerBoundData = new DataConstr( 0, [] ); // PNegInf 
    }
    else
    {
        if( !isNormalizedGenesisInfos( geneisInfos ) )
        {
            throw new Error("missing genesis infos requried to translate slot number to posix")
        }

        lowerBoundData = new DataConstr( // PExtended
            1, // PFinite
            [
                new DataI(
                    slotToPOSIX(
                        unsafeForceUInt( startSlot ),
                        geneisInfos
                    )
                )
            ]
        );
    }

    const endSlot = ttlSlot;
    
    let upperBoundData: Data | undefined = undefined;

    if( endSlot === undefined )
    {
        upperBoundData = new DataConstr( 2, [] ); // PPosInf 
    }
    else
    {
        if( !isNormalizedGenesisInfos( geneisInfos ) )
        {
            throw new Error("missing genesis infos requried to translate slot number to posix")
        }

        upperBoundData = new DataConstr( // PExtended
            1, // PFinite
            [
                new DataI(
                    slotToPOSIX(
                        unsafeForceUInt( endSlot ),
                        geneisInfos
                    )
                )
            ]
        );
    }

    return new DataConstr(
        0, // PPosixTimeRange (PInterval) only constructor
        [
            // from
            new DataConstr( // PBound
                0, // only constructor
                [
                    // bound
                    lowerBoundData,
                    // inclusive
                    new DataConstr( 0, [] ) // PDataBool; True
                ]
            ),
            // to
            new DataConstr( // PBound
                0, // only constructor
                [
                    // bound
                    upperBoundData,
                    // inclusive
                    new DataConstr( 0, [] ) // PDataBool; True
                ]
            ),
        ]
    );
}