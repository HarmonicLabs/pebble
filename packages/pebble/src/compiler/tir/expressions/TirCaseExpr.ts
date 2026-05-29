import { HasSourceRange } from "../../../ast/nodes/HasSourceRange";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { prettyIRInline, prettyIRText } from "../../../IR";
import { IRApp, _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRCase } from "../../../IR/IRNodes/IRCase";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { IRError } from "../../../IR/IRNodes/IRError";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
import { IRLetted } from "../../../IR/IRNodes/IRLetted";
import { IRNative } from "../../../IR/IRNodes/IRNative";
import { IRVar } from "../../../IR/IRNodes/IRVar";
import type { IRTerm } from "../../../IR/IRTerm";
import { _ir_lazyIfThenElse } from "../../../IR/tree_utils/_ir_lazyIfThenElse";
import { _ir_let, _ir_let_sym } from "../../../IR/tree_utils/_ir_let";
import { filterSortedStrArrInplace } from "../../../utils/array/filterSortedStrArrInplace";
import { mergeSortedStrArrInplace } from "../../../utils/array/mergeSortedStrArrInplace";
import { TirNamedDeconstructVarDecl } from "../statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSimpleVarDecl } from "../statements/TirVarDecl/TirSimpleVarDecl";
import { TirDataOptT } from "../types/TirNativeType/native/Optional/data";
import { TirSopOptT } from "../types/TirNativeType/native/Optional/sop";
import { TirDataStructType, TirSoPStructType } from "../types/TirStructType";
import { TirEnumType } from "../types/TirEnumType";
import { TirType } from "../types/TirType";
import { getUnaliased } from "../types/utils/getUnaliased";
import { ITirExpr } from "./ITirExpr";
import { TirExpr } from "./TirExpr";
import { _inlineFromData } from "./TirFromDataExpr";
import { ToIRTermCtx } from "./ToIRTermCtx";

export class TirCaseExpr
    implements ITirExpr
{
    private readonly _creationStack: string | undefined;
    constructor(
        public matchExpr: TirExpr,
        readonly cases: TirCaseMatcher[],
        readonly wildcardCase: TirWildcardCaseMatcher | undefined,
        readonly type: TirType,
        readonly range: SourceRange,
    ) {
        // this._creationStack = (new Error()).stack;
    }

    toString(): string
    {
        const casesStr = this.cases.map( c =>
            `is ${c.pattern.toString()} => ${c.body.toString()}`
        ).join(" ");

        const wildcardStr = this.wildcardCase
            ? `else ${this.wildcardCase.body.toString()}`
            : "";

        return `(case ${this.matchExpr.toString()} ${casesStr} ${wildcardStr})`;
    }

    pretty( indent: number ): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        const indent_0 = "\n" + indent_base;
        const indent_1 = indent_0 + singleIndent;

        const casesPart = this.cases.map(
            c => `${indent_1}is ${c.pattern.pretty(indent + 1)} => ${c.body.pretty(indent + 1)}`
        ).join("");

        const wildcardPart = this.wildcardCase
            ? `${indent_1}else ${this.wildcardCase.body.pretty(indent + 1)}`
            : "";

        return (
            `(case ${this.matchExpr.pretty(indent + 1)}` +
            casesPart +
            wildcardPart +
            `${indent_0})`
        );
    }

    /// @ts-ignore Return type annotation circularly references itself.
    clone(): TirExpr
    {
        return new TirCaseExpr(
            this.matchExpr.clone(),
            this.cases.map( c => new TirCaseMatcher(
                c.pattern, c.body.clone(), c.range.clone()
            )),
            this.wildcardCase ? new TirWildcardCaseMatcher(
                this.wildcardCase.body.clone(),
                this.wildcardCase.range.clone()
            ) : undefined,
            this.type.clone(),
            this.range.clone()
        );
    }

    deps(): string[]
    {
        const deps: string[] = this.matchExpr.deps();
        for( const matcher of this.cases ) {
            mergeSortedStrArrInplace( deps, matcher.deps() );
        }
        if( this.wildcardCase ) mergeSortedStrArrInplace( deps, this.wildcardCase.deps() );
        return deps;
    }

    get isConstant(): boolean { return false }

    toIR( ctx: ToIRTermCtx ): IRTerm
    {
        // console.log( this.pretty(2) );
        const matchExprType = getUnaliased( this.matchExpr.type );
        if(
            matchExprType instanceof TirSoPStructType
            || matchExprType instanceof TirSopOptT
        ) return this._sopStructToIR( matchExprType, ctx );

        if(
            matchExprType instanceof TirDataStructType
            && matchExprType.untagged
        ) return this._untaggedDataStructToIR( matchExprType, ctx );

        if(
            matchExprType instanceof TirDataStructType
            || matchExprType instanceof TirDataOptT
        ) return this._dataStructToIR( matchExprType, ctx );

        if( matchExprType instanceof TirEnumType )
        return this._enumToIR( matchExprType, ctx );

        console.error( this );
        throw new Error(
            "`case` expressions are only supported on Sum-of-Products or Data Struct types; got: "
            + this.matchExpr.type.toString()
        );
    }

    /**
     * Lowers a `case` over an untagged data struct (single constructor;
     * runtime form is `listData(fields)`). No constructor dispatch is
     * needed — there's only one possible ctor — so the lowering is just
     * "find the matching arm (or wildcard), extract any bound fields, run
     * the body".
     */
    private _untaggedDataStructToIR(
        matchExprType: TirDataStructType,
        ctx: ToIRTermCtx
    ): IRTerm
    {
        if( matchExprType.constructors.length !== 1 ) {
            throw new Error(
                "untagged data struct must have exactly one constructor"
            );
        }
        const ctor = matchExprType.constructors[0];

        const wildcardBodyIR = this.wildcardCase?.body.toIR( ctx ) ?? new IRError();

        const matchedArm = this.cases.find(
            c => c.pattern.constrName === ctor.name
        );
        if( !matchedArm ) {
            // no matching arm: just run the wildcard body (the scrutinee is
            // evaluated for side-effects via `unListData` only if any field
            // would have been bound; here, nothing).
            return wildcardBodyIR;
        }

        const pattern = matchedArm.pattern;
        const usedFields = ctor.fields
            .map( ( f, idx ) => ({ name: f.name, type: f.type, idx }))
            .filter( f => pattern.fields.has( f.name ));

        // 0 bound fields → just run the body; no extraction.
        if( usedFields.length === 0 ) return matchedArm.body.toIR( ctx );

        // fields-list = unListData(scrutinee), bound once and reused via
        // IRLetted so the let-handling pass elides or shares as appropriate.
        const fieldsListLetted = new IRLetted(
            Symbol("untaggedFields"),
            _ir_apps(
                IRNative.unListData,
                this.matchExpr.toIR( ctx )
            )
        );

        const branchCtx = ctx.newChild();

        // bind each used field with a let in declaration order.
        // sort by ctor field index so earlier extractions don't need to
        // re-drop past already-bound fields.
        usedFields.sort( ( a, b ) => a.idx - b.idx );

        const bindings: { sym: symbol, extract: IRTerm }[] = usedFields.map( f => {
            const varDecl = pattern.fields.get( f.name );
            if(!( varDecl instanceof TirSimpleVarDecl ))
                throw new Error("case pattern not expressified.");
            const sym = branchCtx.defineVar( varDecl.name );
            return {
                sym,
                extract: _inlineFromData(
                    f.type,
                    _ir_apps(
                        IRNative.headList,
                        _ir_apps(
                            IRNative.dropList,
                            IRConst.int( f.idx ),
                            fieldsListLetted.clone()
                        )
                    )
                )
            };
        });

        // build nested let-bindings around the body
        let result: IRTerm = matchedArm.body.toIR( branchCtx );
        for( let i = bindings.length - 1; i >= 0; i-- ) {
            const { sym, extract } = bindings[i];
            result = _ir_let_sym( sym, extract, result );
        }
        return result;
    }

    private _enumToIR(
        enumType: TirEnumType,
        ctx: ToIRTermCtx
    ): IRTerm
    {
        const wildcardBodyIR = this.wildcardCase?.body.toIR( ctx ) ?? new IRError();
        const branches: IRTerm[] = enumType.members.map( memberName => {
            const branch = this.cases.find(
                c => c.pattern.constrName === memberName
            );
            return branch ? branch.body.toIR( ctx ) : wildcardBodyIR;
        });

        while( branches.length > 0 && branches[ branches.length - 1 ] instanceof IRError )
            branches.pop();

        return branches.length > 0
            ? new IRCase( this.matchExpr.toIR( ctx ), branches )
            : new IRError();
    }

    private _sopStructToIR(
        matchExprType: TirSoPStructType | TirSopOptT,
        ctx: ToIRTermCtx
    ): IRTerm
    {
        if( matchExprType instanceof TirSopOptT )
        {
            const wildcardBodyIR = this.wildcardCase?.body.toIR( ctx ) ?? new IRError();

            const someBranchCtx = ctx.newChild();
            const someBranch = this.cases.find(
                c => c.pattern.constrName === "Some"
            );
            let someBranchVarSym: symbol = Symbol("some_value_unused");
            let someValueType: TirType | undefined = undefined;
            if( someBranch ) {
                const varDecl = someBranch.pattern.fields.values().next().value;
                if(!( varDecl instanceof TirSimpleVarDecl ))
                throw new Error("case pattern not expressified.");
                someBranchVarSym = someBranchCtx.defineVar( varDecl.name );
                someValueType = varDecl.type;
            }
            const someBranchIR = someBranch?.body.toIR( someBranchCtx ) ?? wildcardBodyIR;

            const noneBranchIR = this.cases.find(
                c => c.pattern.constrName === "None"
            )?.body.toIR( ctx ) ?? wildcardBodyIR;

            // The SoP Optional wraps raw data values from lookups;
            // apply _inlineFromData to convert to the expected native type
            // (e.g., unMapData for LinearMap values)
            const rawValueSym = Symbol("sop_opt_raw_value");
            const someHandler: IRTerm = someValueType
                ? new IRFunc([ rawValueSym ],
                    new IRApp(
                        new IRFunc([ someBranchVarSym ], someBranchIR ),
                        _inlineFromData( someValueType, new IRVar( rawValueSym ) )
                    )
                )
                : new IRFunc([ someBranchVarSym ], someBranchIR );

            return new IRCase(
                this.matchExpr.toIR( ctx ), [
                    // Some{ value }
                    someHandler,
                    // None
                    noneBranchIR
                ]
            );
        }

        // TirSopStructType
        const wildcardBodyIR = this.wildcardCase?.body.toIR( ctx ) ?? new IRError();

        // For narrowed SoP types, `matchExprType.constructors` may be a strict
        // subset of the runtime universe. The IRCase branch array must be
        // indexed by runtime (parent) ctor index, so we build it sized to the
        // largest parent index we know about and fill missing slots with the
        // wildcard / IRError.
        const sopType = matchExprType instanceof TirSopOptT ? undefined : matchExprType;
        const sopParentIdxs = sopType?.narrowedFromParentCtorIdxs;
        const localBranches: IRTerm[] = matchExprType.constructors.map(
            (ctor, ctorIdx) => {

                const nFields = ctor.fields.length;

                const branchCtx = ctx.newChild();
                const branch = this.cases.find(
                    c => c.pattern.constrName === ctor.name
                );

                if( !branch ) {
                    if( nFields <= 0 ) return wildcardBodyIR;

                    const introducedVars = Array( nFields ).fill(0).map(() => branchCtx.pushUnusedVar() );
                    return new IRFunc( introducedVars, wildcardBodyIR );
                }

                const pattern = branch.pattern;
                const introducedVars: symbol[] = new Array( nFields );
                for( let i = 0; i < nFields; i++ ) {
                    const field = ctor.fields[i];
                    const varDecl = pattern.fields.get( field.name );
                    if( !varDecl ) {
                        // increment debrujin
                        // variable is still introduced, even if unused
                        introducedVars[i] = branchCtx.pushUnusedVar();
                        continue;
                    }
                    if(!(varDecl instanceof TirSimpleVarDecl ))
                    throw new Error("case pattern not expressified.");

                    introducedVars[i] = branchCtx.defineVar( varDecl.name );
                }

                // console.log( nFields, introducedVars, branchCtx.allVariables() );

                if( nFields <= 0 ) return branch.body.toIR( branchCtx );

                return new IRFunc( introducedVars, branch.body.toIR( branchCtx ) );
            }
        );

        // Map local branches into runtime-indexed slots. For un-narrowed types
        // this is identity.
        let branches: IRTerm[];
        if( sopParentIdxs )
        {
            const maxParent = sopParentIdxs.reduce( ( m, x ) => x > m ? x : m, -1 );
            branches = new Array( maxParent + 1 );
            for( let i = 0; i < branches.length; i++ ) branches[i] = wildcardBodyIR;
            for( let localIdx = 0; localIdx < localBranches.length; localIdx++ )
            {
                branches[ sopParentIdxs[localIdx] ] = localBranches[localIdx];
            }
        }
        else
        {
            branches = localBranches;
        }

        // branches at the end that are supposed to "just fail"
        // can be omitted, as the CEK machine will fail if no branch for
        // a given constructor is found
        while(
            branches[ branches.length - 1 ] instanceof IRError
        ) branches.pop();

        return branches.length > 0 ? new IRCase(
            this.matchExpr.toIR( ctx ),
            branches
        ) : new IRError() ; // all branches fail, so the whole expression fails
    }

    private _dataStructToIR(
        matchExprType: TirDataStructType | TirDataOptT,
        ctx: ToIRTermCtx
    ): IRTerm
    {
        // TirDataOptT extends TirDataStructType (constructors Some{value}, None{}),
        // so the same logic handles it.
        //
        // Lowering structure (UPLC `Case` accepts pair / int scrutinees
        // as untagged constructors):
        //
        //   Case (unConstrData scrutinee) [
        //       \idxSym fieldsSym ->
        //           Case idxSym [body_0, body_1, ..., body_(maxParent)]
        //   ]
        //
        // - The outer `Case` over the `pair(int, list<data>)` returned by
        //   `unConstrData` extracts both halves via a single 2-arg branch
        //   (pair is treated as `constr 0 [fst, snd]`).
        // - The inner `Case` over `idxSym` dispatches by tag in O(1) —
        //   no `equalsInteger` chain, no `lazyIfThenElse`.
        // - Each inner branch takes 0 args (an int N is treated as
        //   `constr N []`). The branch body extracts fields lazily from
        //   `fieldsSym` via deferred access on `thenCtx`, wrapped in
        //   `IRLetted` so the letted-handling pass dedups, inlines or
        //   elides as appropriate.

        if(
            this.cases.some(({ pattern }) =>
                matchExprType.constructors.findIndex( ctor => ctor.name === pattern.constrName ) < 0
            )
        ) throw new Error("case expression includes unknown constructor.");

        const stmtCtx = ctx.newChild();
        const wildcardBodyIR = this.wildcardCase?.body.toIR( stmtCtx ) ?? new IRError();

        // outer destructuring binders — symbols allocated up-front so
        // per-arm deferred accesses (closures) reference the same syms
        const idxSym = Symbol("ctorIdx");
        const fieldsListSym = Symbol("fieldsList");

        // The runtime value's ctor tag spans all parent indices known to
        // this type — not just the indices that appear as arm patterns.
        // Size the inner-Case branch array to cover all of them and fill
        // missing slots with the wildcard.
        const armsByParentIdx = new Map<number, IRTerm>();
        // TirDataOptT extends TirDataStructType, so both have parentCtorIdx
        const allParentIdxs: number[] = matchExprType.constructors.map(
            ( _, i ) => matchExprType.parentCtorIdx( i )
        );
        let maxParentIdx = allParentIdxs.reduce( ( m, x ) => x > m ? x : m, -1 );

        for( const matchCase of this.cases ) {
            const { pattern, body } = matchCase;
            const ctorIdx = matchExprType.constructors.findIndex(
                ctor => ctor.name === pattern.constrName
            );
            const ctor = matchExprType.constructors[ ctorIdx ];

            const parentCtorIdx =
                matchExprType instanceof TirDataStructType
                    ? matchExprType.parentCtorIdx( ctorIdx )
                    : ctorIdx;

            // bind each pattern-named field as a deferred access on
            // `fieldsListSym`. Each access produces an `IRLetted`
            // wrapping `_inlineFromData(type, headList(_dropList(idx, fields)))`.
            const armCtx = stmtCtx.newChild();
            const usedFieldsCtorNames = ctor.fields
                .map( f => f.name )
                .filter( fName => pattern.fields.has( fName ) );

            for( const fName of usedFieldsCtorNames ) {
                const patternVarDecl = pattern.fields.get( fName );
                if(!( patternVarDecl instanceof TirSimpleVarDecl ))
                    throw new Error("case pattern not expressified.");
                const fieldIdx = ctor.fields.findIndex( f => f.name === fName );
                if( fieldIdx < 0 ) throw new Error("case pattern not expressified.");
                const fieldType = patternVarDecl.type;
                armCtx.defineDeferredAccess( patternVarDecl.name, () =>
                    new IRLetted(
                        Symbol(`${ctor.name}_${fName}`),
                        _inlineFromData(
                            fieldType,
                            _ir_apps(
                                IRNative.headList,
                                _ir_apps(
                                    IRNative.dropList,
                                    IRConst.int( fieldIdx ),
                                    new IRVar( fieldsListSym )
                                )
                            )
                        )
                    )
                );
            }

            armsByParentIdx.set( parentCtorIdx, body.toIR( armCtx ) );
        }

        // build inner-Case branches sized to `maxParentIdx + 1`, filling
        // missing slots with the wildcard body
        const innerBranches: IRTerm[] = new Array( maxParentIdx + 1 );
        for( let i = 0; i < innerBranches.length; i++ ) {
            innerBranches[i] = armsByParentIdx.get( i ) ?? wildcardBodyIR;
        }

        // trailing `IRError` branches can be omitted — the CEK machine
        // fails naturally if no branch exists for the runtime tag
        while(
            innerBranches.length > 0
            && innerBranches[ innerBranches.length - 1 ] instanceof IRError
        ) innerBranches.pop();

        const innerCase: IRTerm = innerBranches.length > 0
            ? new IRCase( new IRVar( idxSym ), innerBranches )
            : new IRError();

        // outer Case over the pair: single branch destructures (idx, fields)
        return new IRCase(
            _ir_apps( IRNative.unConstrData, this.matchExpr.toIR( ctx ) ),
            [
                new IRFunc(
                    [ idxSym, fieldsListSym ],
                    innerCase
                )
            ]
        );
    }
}

export type TirCasePattern
    = TirNamedDeconstructVarDecl
    // | TirSingleDeconstructVarDecl
    // | TirArrayLikeDeconstr
    ;

export class TirCaseMatcher
    implements HasSourceRange
{
    constructor(
        readonly pattern: TirCasePattern,
        public body: TirExpr,
        readonly range: SourceRange,
    ) {}

    deps(): string[]
    {
        const nonDeps = this.pattern.introducedVars();
        const deps: string[] = this.body.deps();
        filterSortedStrArrInplace( deps, nonDeps );
        return deps;
    }

    pretty(indent: number): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `is ${this.pattern.pretty(indent)} => ${this.body.pretty(indent)}`;
    }
}

export class TirWildcardCaseMatcher
    implements HasSourceRange
{
    constructor(
        public body: TirExpr,
        readonly range: SourceRange,
    ) {}

    deps(): string[]
    {
        return this.body.deps();
    }

    pretty(indent: number): string
    {
        const singleIndent = "  ";
        const indent_base = singleIndent.repeat(indent);
        return `else ${this.body.pretty(indent)}`;
    }
}