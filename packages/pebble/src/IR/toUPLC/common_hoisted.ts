import { DataConstr } from "@harmoniclabs/plutus-data"
import { IRHoisted } from "../IRNodes/IRHoisted"
import { IRConst } from "../IRNodes/IRConst"

// Computed LAZILY (memoized) rather than at module-initialization time.
// A top-level `new IRHoisted( IRConst.data(...) )` runs during this module's
// load, which — when the module is pulled into an import cycle (e.g.
// TypedProgram -> populateBuiltinInterfaces -> TirToDataExpr -> here) — could
// execute before `IRConst` finished initializing, throwing "cannot read
// 'data' of undefined". Deferring the work to first use makes the value
// order-independent, so every consumer can import it with a plain static
// import (no lazy `require`).
let _hoisted_constr1_empty: IRHoisted | undefined;
export function hoisted_constr1_empty(): IRHoisted
{
    return ( _hoisted_constr1_empty ??= new IRHoisted(
        IRConst.data( new DataConstr( 1, [] ) )
    ) );
}
