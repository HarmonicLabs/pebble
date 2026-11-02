// load the compiler the way users do: this module alone enters an import cycle in another order
import "../../../../index";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { installIRRangeStamping, stampsIRRange, tirExpressionModules } from "../installIRRangeStamping";

/** every `.ts` file under `dir` that defines a `toIR` method (tests excluded) */
function modulesDefiningToIR( dir: string ): string[]
{
    const found: string[] = [];
    for( const name of readdirSync( dir ) )
    {
        const full = join( dir, name );
        if( statSync( full ).isDirectory() )
        {
            if( name !== "__tests__" ) found.push( ...modulesDefiningToIR( full ) );
            continue;
        }
        if( name.endsWith( ".ts" ) && /^\s*toIR\s*\(/m.test( readFileSync( full, "utf8" ) ) ) found.push( full );
    }
    return found;
}

describe("installIRRangeStamping", () => {

    installIRRangeStamping();
    const root = join( __dirname, ".." );

    test("covers every TIR expression class with a `toIR`", () => {
        const uncovered: string[] = [];
        for( const file of modulesDefiningToIR( root ) )
        {
            const mod = require( file );
            for( const [ name, exported ] of Object.entries( mod ) )
            {
                if( typeof exported === "function" && typeof ( exported as any ).prototype?.toIR === "function" && !stampsIRRange( exported as Function ) )
                uncovered.push( `${relative( root, file )}: ${name}` );
            }
        }
        // add the module to `tirExpressionModules` in installIRRangeStamping.ts
        expect( uncovered ).toEqual( [] );
    });

    test("lists only modules that define TIR expressions", () => {
        for( const mod of tirExpressionModules )
        expect( Object.values( mod ).some( e => typeof e === "function" && typeof ( e as any ).prototype?.toIR === "function" ) ).toBe( true );
    });

    test("is idempotent", () => {
        const [ cls ] = Object.values( tirExpressionModules[0] ).filter( e => typeof e === "function" ) as any[];
        const wrapped = cls.prototype.toIR;
        installIRRangeStamping();
        expect( cls.prototype.toIR ).toBe( wrapped );
    });
});
