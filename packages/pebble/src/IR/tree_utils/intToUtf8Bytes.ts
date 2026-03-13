import { IRApp, _ir_apps } from "../IRNodes/IRApp";
import { IRConst } from "../IRNodes/IRConst";
import { IRFunc } from "../IRNodes/IRFunc";
import { IRHoisted } from "../IRNodes/IRHoisted";
import { IRNative } from "../IRNodes/IRNative";
import { IRRecursive } from "../IRNodes/IRRecursive";
import { IRSelfCall } from "../IRNodes/IRSelfCall";
import { IRVar } from "../IRNodes/IRVar";
import { IRTerm } from "../IRTerm";
import { _ir_lazyIfThenElse } from "./_ir_lazyIfThenElse";

// digitToBytes(n) = consByteString( addInteger(n, 48), #"" )
// positiveIntToBs = fix \self \n ->
//   ifThenElse (lessThanInteger n 10)
//     (consByteString (addInteger n 48) #"")
//     (appendByteString (self (divideInteger n 10)) (consByteString (addInteger (modInteger n 10) 48) #""))
// intToUtf8Bytes(n) =
//   ifThenElse (lessThanEqualInteger 0 n)
//     (positiveIntToBs n)
//     (appendByteString (consByteString 45 #"") (positiveIntToBs (subtractInteger 0 n)))

const self_sym = Symbol("intToUtf8Bytes_self");
const n_sym = Symbol("intToUtf8Bytes_n");
const outer_n_sym = Symbol("intToUtf8Bytes_outer_n");

const emptyBs = IRConst.bytes( new Uint8Array(0) );

function digitToBytes( n: IRTerm ): IRTerm
{
    return _ir_apps(
        IRNative.consByteString,
        _ir_apps( IRNative.addInteger, n, IRConst.int(48) ),
        emptyBs.clone()
    );
}

const hoisted_positiveIntToBs = new IRHoisted(
    new IRRecursive(
        self_sym,
        new IRFunc(
            [ n_sym ],
            _ir_lazyIfThenElse(
                // condition: n < 10
                _ir_apps( IRNative.lessThanInteger, new IRVar( n_sym ), IRConst.int(10) ),
                // then: digitToBytes(n)
                digitToBytes( new IRVar( n_sym ) ),
                // else: appendByteString( self(n / 10), digitToBytes(n % 10) )
                _ir_apps(
                    IRNative.appendByteString,
                    new IRApp(
                        new IRSelfCall( self_sym ),
                        _ir_apps( IRNative.divideInteger, new IRVar( n_sym ), IRConst.int(10) )
                    ),
                    digitToBytes(
                        _ir_apps( IRNative.modInteger, new IRVar( n_sym ), IRConst.int(10) )
                    )
                )
            )
        )
    )
);
hoisted_positiveIntToBs.hash;

/**
 * Hoisted IR term: `int -> bytes`
 *
 * Converts an integer to its decimal UTF-8 byte representation.
 * Handles negative numbers by prepending '-' (0x2d).
 */
export const hoisted_intToUtf8Bytes = new IRHoisted(
    new IRFunc(
        [ outer_n_sym ],
        _ir_lazyIfThenElse(
            // condition: 0 <= n
            _ir_apps( IRNative.lessThanEqualInteger, IRConst.int(0), new IRVar( outer_n_sym ) ),
            // then: positiveIntToBs(n)
            _ir_apps( hoisted_positiveIntToBs.clone(), new IRVar( outer_n_sym ) ),
            // else: appendByteString( consByteString(45, #""), positiveIntToBs(0 - n) )
            _ir_apps(
                IRNative.appendByteString,
                // "-" as bytes
                _ir_apps( IRNative.consByteString, IRConst.int(45), emptyBs.clone() ),
                _ir_apps(
                    hoisted_positiveIntToBs.clone(),
                    _ir_apps( IRNative.subtractInteger, IRConst.int(0), new IRVar( outer_n_sym ) )
                )
            )
        )
    )
);
hoisted_intToUtf8Bytes.hash;
