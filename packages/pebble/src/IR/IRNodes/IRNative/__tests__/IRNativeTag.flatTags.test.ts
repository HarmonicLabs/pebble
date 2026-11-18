import { Builtin, UPLCBuiltinTag, UPLCProgram, compileUPLC } from "@harmoniclabs/uplc";
import { IRNative } from "..";
import { IRNativeTag } from "../IRNativeTag";

/**
 * A non-negative `IRNativeTag` IS the flat tag of a builtin: `IRNative.toUPLC`
 * hands the number to `Builtin` as it is. So the two enums must give every
 * builtin the same number, and that number must be Plutus'. They did agree,
 * on a wrong one: `bls12_381_G1_hashToGroup`, `_compress`, `_uncompress` were
 * 58, 59, 60 here and in `@harmoniclabs/uplc` (and 65, 66, 67 for G2), in the
 * order Plutus declares the constructors; it encodes them compress 58,
 * uncompress 59, hashToGroup 60 (65, 66, 67). A script compiled so calls
 * `hashToGroup` on a node where its source says `uncompress` — and runs as
 * written on a machine that reads the same wrong table (PEBBLE_BUGS.md, BUG 86).
 */
describe( "IRNativeTag: a non-negative tag is the builtin's flat tag", () => {

    const natives = Object.entries( IRNativeTag ).filter( ( [ , v ] ) => typeof v === "number" && ( v as number ) >= 0 ) as [ string, number ][];
    const builtins = Object.entries( UPLCBuiltinTag ).filter( ( [ , v ] ) => typeof v === "number" ) as [ string, number ][];

    /** the two builtins the IR calls by another name: it has lazy forms of its own under the plain ones */
    const uplcName = ( native: string ): string => native === "strictIfThenElse" ? "ifThenElse" : native === "strictChooseList" ? "chooseList" : native;

    test( "every builtin has the same number in both enums, by name", () => {
        expect( natives.length ).toBe( builtins.length );
        for( const [ name, tag ] of natives ) expect( [ name, ( UPLCBuiltinTag as any )[ uplcName( name ) ] ] ).toEqual( [ name, tag ] );
        for( const [ name, tag ] of builtins ) expect( [ name, uplcName( ( IRNativeTag as any )[ tag ] ) ] ).toEqual( [ name, name ] );
    });

    test( "the BLS builtins Plutus encodes in another order than it declares them", () => {
        expect( [ IRNativeTag.bls12_381_G1_compress, IRNativeTag.bls12_381_G1_uncompress, IRNativeTag.bls12_381_G1_hashToGroup ] ).toEqual( [ 58, 59, 60 ] );
        expect( [ IRNativeTag.bls12_381_G2_compress, IRNativeTag.bls12_381_G2_uncompress, IRNativeTag.bls12_381_G2_hashToGroup ] ).toEqual( [ 65, 66, 67 ] );
    });

    test( "what the compiler writes for `g1Uncompress` is the bytes a node reads as bls12_381_G1_uncompress", () => {
        const term = IRNative.bls12_381_G1_uncompress.toUPLC();
        expect( term instanceof Builtin && term.builtinTag ).toBe( 59 );
        // (program 1.1.0 (builtin bls12_381_G1_uncompress)): term tag 0111, builtin 0111011, padding 00001
        expect( Array.from( compileUPLC( new UPLCProgram( [ 1, 1, 0 ], term ) ) ) ).toEqual( [ 1, 1, 0, 0x77, 0x61 ] );
        const hash = IRNative.bls12_381_G2_hashToGroup.toUPLC();
        expect( Array.from( compileUPLC( new UPLCProgram( [ 1, 1, 0 ], hash ) ) ) ).toEqual( [ 1, 1, 0, 0x78, 0x61 ] );
    });
});
