import { _ir_apps } from "../IRNodes/IRApp";
import { IRConst } from "../IRNodes/IRConst";
import { IRFunc } from "../IRNodes/IRFunc";
import { IRHoisted } from "../IRNodes/IRHoisted";
import { IRNative } from "../IRNodes/IRNative";
import { IRRecursive } from "../IRNodes/IRRecursive";
import { IRSelfCall } from "../IRNodes/IRSelfCall";
import { IRVar } from "../IRNodes/IRVar";
import { IRTerm } from "../IRTerm";
import { _ir_lazyIfThenElse } from "./_ir_lazyIfThenElse";

// hexChar(n) = if n < 10 then n + 48 else n + 87   // '0' = 48, 'a' = 97 = 87+10
// goAt(bs, len, i) = if i >= len then ""
//                    else cons(hexChar(b/16), cons(hexChar(b%16), goAt(bs, len, i+1)))
//                    where b = indexByteString(bs, i)
// bytesToHex(bs) = goAt(bs, lengthOfByteString(bs), 0)

const emptyBs = IRConst.bytes( new Uint8Array(0) );

const hexCharSym = Symbol("hexChar_n");
const hoisted_hexChar = new IRHoisted(
    new IRFunc(
        [ hexCharSym ],
        _ir_lazyIfThenElse(
            // n < 10
            _ir_apps( IRNative.lessThanInteger, new IRVar( hexCharSym ), IRConst.int(10) ),
            // then n + 48
            _ir_apps( IRNative.addInteger, new IRVar( hexCharSym ), IRConst.int(48) ),
            // else n + 87
            _ir_apps( IRNative.addInteger, new IRVar( hexCharSym ), IRConst.int(87) ),
        ),
    )
);
hoisted_hexChar.hash;

// Iteration over the bytes of `bs` from offset 0 to len (passed in as args).
// We avoid re-computing length on each step.
//
//   self(bs, len, i) =
//       if i >= len then ""
//       else
//           let b = indexByteString(bs, i)
//           cons( hexChar( quotient(b, 16) ),
//             cons( hexChar( mod(b, 16) ),
//               self(bs, len, i + 1)))
const self_sym  = Symbol("bytesToHex_self");
const bs_sym    = Symbol("bytesToHex_bs");
const len_sym   = Symbol("bytesToHex_len");
const i_sym     = Symbol("bytesToHex_i");
const b_sym     = Symbol("bytesToHex_b");

const hoisted_bytesToHex_loop = new IRHoisted(
    new IRRecursive(
        self_sym,
        new IRFunc(
            [ bs_sym, len_sym, i_sym ],
            _ir_lazyIfThenElse(
                // i >= len  <=> NOT (i < len)
                _ir_apps( IRNative.lessThanInteger, new IRVar( i_sym ), new IRVar( len_sym ) ),
                // then: process byte at i and recurse
                ((): IRTerm => {
                    // let b = indexByteString(bs, i)
                    const b = _ir_apps( IRNative.indexByteString, new IRVar( bs_sym ), new IRVar( i_sym ) );
                    // The IR currently doesn't have a direct `let` form here; we
                    // emit b twice. The optimiser hoists common sub-expressions
                    // when they're cheap; for the byte-at-index access this is
                    // acceptable (two cheap builtin calls each iteration).
                    const high = _ir_apps( hoisted_hexChar.clone(), _ir_apps( IRNative.quotientInteger, b, IRConst.int(16) ) );
                    const lowB = _ir_apps( IRNative.indexByteString, new IRVar( bs_sym ), new IRVar( i_sym ) );
                    const low  = _ir_apps( hoisted_hexChar.clone(), _ir_apps( IRNative.modInteger, lowB, IRConst.int(16) ) );
                    return _ir_apps(
                        IRNative.consByteString, high,
                        _ir_apps(
                            IRNative.consByteString, low,
                            // self(bs, len, i + 1)
                            _ir_apps(
                                new IRSelfCall( self_sym ),
                                new IRVar( bs_sym ),
                                new IRVar( len_sym ),
                                _ir_apps( IRNative.addInteger, new IRVar( i_sym ), IRConst.int(1) )
                            ),
                        )
                    );
                })(),
                // else: empty bytes
                emptyBs.clone(),
            )
        )
    )
);
hoisted_bytesToHex_loop.hash;

const outer_bs_sym = Symbol("bytesToHex_outer_bs");

/**
 * Hoisted IR term: `bytes -> bytes`
 *
 * Converts a bytestring to its lowercase hex (`0-9a-f`) UTF-8 encoding.
 * 1-byte input becomes 2 bytes; 32-byte input (e.g. a hash) becomes 64 bytes.
 */
export const hoisted_bytesToHex = new IRHoisted(
    new IRFunc(
        [ outer_bs_sym ],
        _ir_apps(
            hoisted_bytesToHex_loop.clone(),
            new IRVar( outer_bs_sym ),
            _ir_apps( IRNative.lengthOfByteString, new IRVar( outer_bs_sym ) ),
            IRConst.int(0),
        )
    )
);
hoisted_bytesToHex.hash;
