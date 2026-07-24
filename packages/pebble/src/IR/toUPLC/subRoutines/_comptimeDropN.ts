import { IRHoisted, IRFunc, IRNative, IRVar, _ir_apps } from "../../IRNodes";
import { IRForced } from "../../IRNodes/IRForced";

// hoist the FORCED builtin: the binding value must be pre-forced, since all
// use sites apply the bound variable directly ([f [f lst]]) without forcing
const tailList = new IRHoisted( new IRForced( IRNative.tailList ) );
tailList.hash;

const drop2_lst = Symbol("lst");
export const hoisted_drop2 = new IRHoisted(
    new IRFunc(
        [ drop2_lst ], // lst
        _ir_apps(
            tailList.clone(),
            _ir_apps(
                tailList.clone(),
                new IRVar( drop2_lst ) // lst
            )
        )
    )
);
hoisted_drop2.hash;

const drop3_lst = Symbol("lst");
export const hoisted_drop3 = new IRHoisted(
    new IRFunc(
        [ drop3_lst ], // lst
        _ir_apps(
            tailList.clone(),
            _ir_apps(
                tailList.clone(),
                _ir_apps(
                    tailList.clone(),
                    new IRVar( drop3_lst ) // lst
                )
            )
        )
    )
);
hoisted_drop3.hash;

const drop4_lst = Symbol("lst");
export const hoisted_drop4 = new IRHoisted(
    new IRFunc( 
        [ drop4_lst ], // lst
        _ir_apps(
            tailList.clone(),
            _ir_apps(
                tailList.clone(),
                _ir_apps(
                    tailList.clone(),
                    _ir_apps(
                        tailList.clone(),
                        new IRVar( drop4_lst ) // lst
                    )
                )
            )
        )
    )
);
hoisted_drop4.hash;

const drop8_lst = Symbol("lst");
export const hoisted_drop8 = new IRHoisted(
    new IRFunc(
        [ drop8_lst ], // lst
        _ir_apps(
            hoisted_drop4.clone(),
            _ir_apps(
                hoisted_drop4.clone(),
                new IRVar( drop8_lst ) // lst
            )
        )
    )
);
hoisted_drop8.hash;

// replace numeric arity version of drop16 with symbol param
const drop16_lst = Symbol("lst");
export const hoisted_drop16 = new IRHoisted(
    new IRFunc(
        [ drop16_lst ],
        _ir_apps(
            hoisted_drop8.clone(),
            _ir_apps(
                hoisted_drop8.clone(),
                new IRVar( drop16_lst )
            )
        )
    )
);
hoisted_drop16.hash;

// replace numeric arity version of drop32 with symbol param
const drop32_lst = Symbol("lst");
export const hoisted_drop32 = new IRHoisted(
    new IRFunc(
        [ drop32_lst ],
        _ir_apps(
            hoisted_drop16.clone(),
            _ir_apps(
                hoisted_drop16.clone(),
                new IRVar( drop32_lst )
            )
        )
    )
);
hoisted_drop32.hash;

export function _compTimeDropN( bigN: bigint ): IRHoisted | IRNative
{
    const n = Number( bigN );
    if( n < 0 ) throw new Error(`Cannot drop a negative number of elements from a list`);
    if( n === 0 ) return IRNative._id;
    if( n === 1 ) return tailList.clone();
    if( n === 2 ) return hoisted_drop2;
    if( n === 3 ) return hoisted_drop3;
    if( n === 4 ) return hoisted_drop4;
    if( n === 8 ) return hoisted_drop8;
    if( n === 16 ) return hoisted_drop16;
    if( n === 32 ) return hoisted_drop32;

    // Greedy decomposition into available drop sizes (largest first)
    let remaining = n;
    const parts: number[] = [];
    const sizes = [32,16,8,4,3,2,1];
    for( const s of sizes )
    {
        while( remaining >= s )
        {
            parts.push( s );
            remaining -= s;
        }
        if( remaining === 0 ) break;
    }

    // Build the composed drop function body by sequential application
    const lst = Symbol("lst"); // symbol param for composed function
    let body: any = new IRVar( lst );
    for( const p of parts )
    {
        switch( p )
        {
            case 32: body = _ir_apps( hoisted_drop32.clone(), body ); break;
            case 16: body = _ir_apps( hoisted_drop16.clone(), body ); break;
            case 8: body = _ir_apps( hoisted_drop8.clone(), body ); break;
            case 4: body = _ir_apps( hoisted_drop4.clone(), body ); break;
            case 3: body = _ir_apps( hoisted_drop3.clone(), body ); break;
            case 2: body = _ir_apps( hoisted_drop2.clone(), body ); break;
            case 1: body = _ir_apps( tailList.clone(), body ); break;
        }
    }

    const hoisted = new IRHoisted( new IRFunc( [ lst ], body ) );
    hoisted.hash;
    return hoisted;
}