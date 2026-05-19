import { IRVar } from "../../../IR/IRNodes/IRVar";
import { IRSelfCall } from "../../../IR/IRNodes/IRSelfCall";
import type { IRTerm } from "../../../IR/IRTerm";

const _1n = BigInt(1);

export class ToIRTermCtx
{
    readonly _creationStack?: string | undefined;
    private readonly localVars: Map<string, symbol> = new Map();
    /**
     * Per-name overrides whose lookup synthesizes a fresh IR term at each
     * access (rather than resolving to a pre-allocated IRVar). Used to
     * implement lazy field extraction in case-arms — the body's references
     * to pattern-bound fields each emit an `IRLetted` over the extraction
     * IR, so the letted-handling pass can dedup, hoist or eliminate as
     * appropriate.
     */
    private readonly deferredAccess: Map<string, () => IRTerm> = new Map();

    private _firstVariableIsRecursive: boolean = false;

    _children: ToIRTermCtx[] = [];

    constructor(
        readonly parent: ToIRTermCtx | undefined,
    ) {
        this.parent?._children.push( this );

        this._creationStack = new Error().stack;
        this.localVars = new Map();

        // DO NOT SET _parentDbn HERE
        // it must be a getter to reflect changes in parent
        // (parent dbn can change)
        this._firstVariableIsRecursive = false;
    }

    localVariables(): string[] {
        return [ ...this.localVars.keys() ];
    }
    allVariables(): string[] {
        return (
            (this.parent?.allVariables() ?? [])
            .concat([ ...this.localVariables() ])
        );
    }

    static root(): ToIRTermCtx {
        return new ToIRTermCtx( undefined );
    }

    newChild(): ToIRTermCtx {
        return new ToIRTermCtx( this );
    }

    private localVarSym( name: string ): symbol | undefined {
        return this.localVars.get( name );
    }

    getVarAccessSym( name: string ): symbol | undefined {
        return (
            this.localVarSym( name )
            ?? this.parent?.getVarAccessSym( name )
        );
    }

    private getDeferredAccessFactory( name: string ): ( () => IRTerm ) | undefined {
        return (
            this.deferredAccess.get( name )
            ?? this.parent?.getDeferredAccessFactory( name )
        );
    }

    getVarAccessIR( name: string ): IRTerm | undefined {
        // deferred accesses (lazy field extraction in case-arms etc.)
        // shadow symbol-based lookups when present.
        const deferred = this.getDeferredAccessFactory( name );
        if( deferred ) return deferred();

        const accessSym = this.getVarAccessSym( name );
        if( typeof accessSym !== "symbol" ) return undefined;

        if(
            this._firstVariableIsRecursive
            && name === this.localVars.keys().next().value
        ) return new IRSelfCall( accessSym );

        return new IRVar( accessSym );
    }

    /**
     * Register a per-name lookup override. Subsequent `getVarAccessIR(name)`
     * calls in this context (or its descendants) return the IR term produced
     * by `factory()`. The factory is invoked once per access — wrap the
     * result in `IRLetted` if you want the IR-level let-handling pass to
     * dedup / hoist / eliminate as appropriate.
     */
    defineDeferredAccess( name: string, factory: () => IRTerm ): void
    {
        if( this.localVars.has( name ) || this.deferredAccess.has( name ) ) {
            throw new Error(`variable '${name}' already defined in the current scope`);
        }
        this.deferredAccess.set( name, factory );
    }

    /**
     * @returns the symbol of the defined variable (for eventual `new IRFunc( ... )`)
    **/
    defineVar( varName: string | symbol ): symbol
    {
        const name = typeof varName === "string" ? varName : varName.description!;

        // allow shadowing
        // const exsistingCtx = this.variableToCtx.get( name );
        // if(
        //     exsistingCtx
        //     && exsistingCtx.localVarSym( name ) !== undefined
        // ) throw new Error(`variable '${name}' already defined in the current scope`);
        if( this.localVars.has( name ) ) {
            throw new Error(`variable '${name}' already defined in the current scope`);
        }

        const sym = typeof varName === "string" ? Symbol( name ) : varName;
        this.localVars.set( name, sym );
        // this.variableToCtx.set( name, this );
        return sym;
    }
    /**
     * @returns the symbol of the defined recursive variable (for eventual `new IRRecursive( ... )`)
    **/
    defineRecursiveVar( name: string ): symbol
    {
        if(
            this.localVars.size > 0
            || this._firstVariableIsRecursive
        ) throw new Error("recursive variable must be the first defined variable in the context");
        
        this._firstVariableIsRecursive = true;
        return this.defineVar( name );
    }

    private _parentDbn: number | undefined = undefined;
    get dbn(): number {
        if( typeof this._parentDbn !== "number" ) this._parentDbn = this.parent instanceof ToIRTermCtx ? this.parent.dbn : 0;
        return this.localVars.size + this._parentDbn;
    }

    pushUnusedVar( postfix?: string ): symbol {
        // this.variables.push( "" );
        // just to increment dbn

        // we need a new unique name in the `variables` map
        // (if we just use empty string, or the same string, it will overwrite the previous "unused" entry)
        // 
        // we start with the number so we know it is not a valid variable name
        // but we add "_unused" so the key is not an integer (which would be sorted first in Object.keys)
        const prefix = this.dbn.toString();
        if(!(
            typeof postfix === "string"
            && postfix.length > 0
        )) postfix = "unused";
        const name = prefix + "_" + postfix;

        const sym = Symbol( name );
        this.localVars.set( name, sym );
        return sym;
    }
}