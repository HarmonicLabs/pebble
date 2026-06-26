
export class RemoveUnusedVarsCtx
{
    readonly localVars: Record<symbol, number>;

    // MUST BE A GETTER TO REFLECT CHANGES IN PARENT
    // DO NOT MODIFY
    // private get _parentDbn(): number {
    //     return this.parent?.dbn ?? 0;
    // }
    // get dbn(): number {
    //     return this._parentDbn + Object.getOwnPropertySymbols( this.localVars ).length;
    // }

    constructor(
        readonly params: symbol[],
        readonly parent: RemoveUnusedVarsCtx | undefined,
    ) {
        params = params.slice();

        this.localVars = {};
        for( const p of params ) this.localVars[p] = 0;
    }

    static root( params: symbol[] = [] ): RemoveUnusedVarsCtx {
        return new RemoveUnusedVarsCtx( params, undefined );
    }

    newChild( params: symbol[] ): RemoveUnusedVarsCtx {
        return new RemoveUnusedVarsCtx( params, this );
    }

    private keys(): symbol[]
    {
        return Object.getOwnPropertySymbols( this.localVars );
    }

    incrementVarUse( sym: symbol ): void
    {
        if( typeof this.localVars[sym] !== "number" ) {
            if( this.parent ) this.parent.incrementVarUse( sym );
            else {
                console.error( sym );
                throw new Error("trying to increment use of variable not in context");
            }
        }
        else this.localVars[sym]++;
    }

    getUnusedVars(): symbol[]
    {
        const keys = this.keys();
        return keys.filter( k => this.localVars[k] === 0 );
    }

}