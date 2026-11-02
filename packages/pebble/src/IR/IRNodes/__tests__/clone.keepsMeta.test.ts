import { IRApp } from "../IRApp";
import { IRCase } from "../IRCase";
import { IRConst } from "../IRConst";
import { IRConstr } from "../IRConstr";
import { IRDelayed } from "../IRDelayed";
import { IRError } from "../IRError";
import { IRForced } from "../IRForced";
import { IRFunc } from "../IRFunc";
import { IRHoisted } from "../IRHoisted";
import { IRLetted } from "../IRLetted";
import { IRNative } from "../IRNative";
import { IRRecursive } from "../IRRecursive";
import { IRSelfCall } from "../IRSelfCall";
import { IRVar } from "../IRVar";
import { IRTerm } from "../../IRTerm";
import { irMeta } from "../../sourceMap/irRanges";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { Source, SourceKind } from "../../../ast/Source/Source";

/**
 * Sourcemaps keep a node's source range in `meta`; the passes clone nodes all the time,
 * so a clone that dropped `meta` dropped the range (9 of the 14 classes used to).
 */
describe("clone() keeps meta", () => {

    const source = new Source( SourceKind.User, "main.pebble", "uid", "function f() {}" );
    const range = new SourceRange( source, 0, 8 );
    const x = Symbol( "x" );
    const self = Symbol( "self" );

    const nodes: [ string, () => IRTerm ][] = [
        [ "IRApp", () => new IRApp( new IRFunc( [ x ], new IRVar( x ) ), IRConst.int( 1 ) ) ],
        [ "IRCase", () => new IRCase( new IRConstr( 0, [] ), [ IRConst.int( 1 ) ] ) ],
        [ "IRConst", () => IRConst.int( 1 ) ],
        [ "IRConstr", () => new IRConstr( 1, [ IRConst.int( 1 ) ] ) ],
        [ "IRDelayed", () => new IRDelayed( IRConst.int( 1 ) ) ],
        [ "IRError", () => new IRError() ],
        [ "IRForced", () => new IRForced( new IRDelayed( IRConst.int( 1 ) ) ) ],
        [ "IRFunc", () => new IRFunc( [ x ], new IRVar( x ) ) ],
        [ "IRHoisted", () => new IRHoisted( new IRFunc( [ x ], new IRVar( x ) ) ) ],
        [ "IRLetted", () => new IRLetted( x, IRConst.int( 1 ) ) ],
        [ "IRNative", () => IRNative.addInteger ],
        [ "IRRecursive", () => new IRRecursive( self, new IRFunc( [ x ], new IRSelfCall( self ) ) ) ],
        [ "IRSelfCall", () => new IRSelfCall( self ) ],
        [ "IRVar", () => new IRVar( x ) ],
    ];

    test.each( nodes )( "%s", ( _, make ) => {
        const node = make();
        const meta = irMeta( node );
        meta.range = range;
        meta.assertCond = range;
        meta.fnEntry = { name: "f", range };

        const cloned = node.clone();
        expect( irMeta( cloned ).range ).toBe( range );
        expect( irMeta( cloned ).assertCond ).toBe( range );
        expect( irMeta( cloned ).fnEntry ).toEqual({ name: "f", range });
        // a copy, not the same object: changing one leaves the other alone
        irMeta( cloned ).range = null;
        expect( meta.range ).toBe( range );
    });

    test("covers every node kind", () => {
        expect( nodes.length ).toBe( 14 );
    });
});
