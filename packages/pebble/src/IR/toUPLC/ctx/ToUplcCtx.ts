
export class ToUplcCtx
{
    readonly parent: ToUplcCtx | undefined;
    readonly ctxMap: Map<symbol, ToUplcCtx>;

    private readonly _variables: symbol[];

    private get _parentDbn(): number {
        return this.parent?.dbn ?? 0;
    }
    get dbn(): number {
        return this._variables.length + this._parentDbn;
    }

    private _frozen: boolean;
    
    constructor(
        parent: ToUplcCtx | undefined,
        variables: symbol[],
    ) {
        this.parent = parent;
        this.ctxMap = this.parent?.ctxMap ?? new Map();
        this._variables = variables;
        for( const v of variables ) this.ctxMap.set( v, this );
    }

    static root(): ToUplcCtx {
        return new ToUplcCtx( undefined, [] );
    }

    newChild( variables: symbol[] ): ToUplcCtx {
        return new ToUplcCtx( this, variables );
    }

    getVarDeclDbn( sym: symbol ): number
    {
        const ctx = this.ctxMap.get( sym );
        const idx = ctx?._variables.indexOf( sym ) ?? -1;
        if( idx <= -1 ) {
            console.error( sym, ctx?.allVars() );
            throw new Error("Variable not found in its defining context");
        }
        return ctx!._parentDbn + idx + 1;
    }

    getVarAccessDbn( sym: symbol ): number
    {
        // Resolve the de Bruijn index LEXICALLY, against this access's own
        // scope chain — i.e. the number of binders between the access and the
        // NEAREST (innermost) enclosing binder of `sym`.
        //
        // The previous implementation looked `sym` up in a single tree-wide
        // `ctxMap` (last writer wins). That is incorrect whenever the same
        // binder symbol appears in sibling scopes — which happens routinely
        // because cloned IR reuses its binder symbols (e.g. the shared
        // `const { tx } = context` destructuring duplicated across a
        // contract's purpose-match cases). An access in one branch would then
        // resolve against another branch's binder, yielding a wrong and
        // sometimes NEGATIVE index ("invalid deBruijn index").
        let offset = 0;
        let ctx: ToUplcCtx | undefined = this;
        while( ctx )
        {
            const vars = ctx._variables;
            for( let i = vars.length - 1; i >= 0; i-- )
            {
                if( vars[i] === sym ) return offset + ( vars.length - 1 - i );
            }
            offset += vars.length;
            ctx = ctx.parent;
        }
        throw new Error("Variable not found in scope chain: " + String( sym.description ));
    }

    toJson(): any
    {
        let obj: any = {};
        let prevCtx: any | null = null;
        let ctx: ToUplcCtx | undefined = this;
        do {
            obj["parentDbn"] = ctx._parentDbn;
            obj["dbn"] = ctx.dbn;
            obj["vars"] = ctx._variables.slice();
            obj["next"] = prevCtx;
            prevCtx = obj;
            obj = {};
            ctx = ctx.parent;
        } while( ctx )
        return prevCtx;
    }

    allVars(): symbol[]
    {
        let vars: symbol[] = [];
        let ctx: ToUplcCtx = this;
        while( ctx = ctx.parent! ) {
            vars = ctx._variables.concat( vars );
        }
        return vars;
    }

    // for debugging purposes
    // "inefficient" but correct way to get expected de bruijn index
    expectedDbn( sym: symbol ): number
    {
        const vars = this.allVars();
        return vars.length - 1 - vars.lastIndexOf( sym )
    }

}