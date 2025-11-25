import { Source } from "../../ast/Source/Source";
import { parseFile } from "../parseFile";

describe("parseFile", () => {

    function testParse( src: string, log: boolean = false )
    {
        test(src, () => {
            let result: Source;
            expect(() => result = parseFile( "test.pebble", src )).not.toThrow();
            log && console.dir( result!.statements, { depth: Infinity } );
        });
    }

    function testParseFailure( src: string, log: boolean = false )
    {
        test(src, () => {
            let result: any;
            expect(() => result = parseFile( "test.pebble", src )).toThrow();
            log && console.log( result );
        });
    }

    describe("simple var decls", () => {
        testParse( "const a = 1;" );
        testParseFailure( "const const = 1;" );
        testParse( "let a = 1;" );
        testParse( "var a = 1;" );
    });

    describe("type keyword", () => {
        testParse( "type Integer = number;" );
        testParse( "type Integer implements MyInterface {};" );
    });

    describe("mutable assignment", () => {
        testParse( "var a = 1; a = 2;" );
        testParse( "var a = 1; a |= 2;" );
    })

    describe("prop access", () => {
        testParse( "const a = b.c;" );
        testParse( "const a = tx.inputs;" );
    });

    describe("for loop", () => {
        testParse( "for( const a of b ) {}" );
    });

    describe("simple main", () => {
        testParse("function main() {}");
        testParse("function main( ctx ) {}");
        testParse("function main( ctx: ScriptContext ) {}");
        testParse("function main( {}: ScriptContext ) {}");
        testParse("function main( { tx }: ScriptContext ) {}");
        testParse("function main( { tx, purpose }: ScriptContext ) {}");
    });
});