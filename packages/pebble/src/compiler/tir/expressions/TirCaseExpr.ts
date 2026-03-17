import { HasSourceRange } from "../../../ast/nodes/HasSourceRange";
import { SourceRange } from "../../../ast/Source/SourceRange";
import { prettyIRInline, prettyIRText } from "../../../IR";
import { IRApp, _ir_apps } from "../../../IR/IRNodes/IRApp";
import { IRCase } from "../../../IR/IRNodes/IRCase";
import { IRConst } from "../../../IR/IRNodes/IRConst";
import { IRDelayed } from "../../../IR/IRNodes/IRDelayed";
import { IRError } from "../../../IR/IRNodes/IRError";
import { IRForced } from "../../../IR/IRNodes/IRForced";
import { IRFunc } from "../../../IR/IRNodes/IRFunc";
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
import { TirType } from "../types/TirType";
import { getOptTypeArg } from "../types/utils/getOptTypeArg";
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
            || matchExprType instanceof TirDataOptT
        ) return this._dataStructToIR( matchExprType, ctx );

        console.error( this );
        throw new Error(
            "`case` expressions are only supported on Sum-of-Products or Data Struct types; got: "
            + this.matchExpr.type.toString()
        );
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
        const branches: IRTerm[] = matchExprType.constructors.map(
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
        if( matchExprType instanceof TirDataOptT )
        {
            const stmtCtx = ctx.newChild();
            stmtCtx.pushUnusedVar(); // debrujin un constr data result

            const wildcardBodyIR = this.wildcardCase?.body.toIR( stmtCtx ) ?? new IRError();

            const someBranch = this.cases.find(
                c => c.pattern.constrName === "Some"
            );
            let someBranchIR: ( unConstrMatchSym: symbol ) => IRTerm = () => new IRFunc([Symbol("unused_some_value")], wildcardBodyIR);
            if( someBranch ) {

                const pattern = someBranch.pattern;
                const valueDecl = pattern.fields.get("value");
                if(
                    valueDecl
                    && !( valueDecl instanceof TirSimpleVarDecl )
                ) throw new Error("case pattern not expressified.");

                const someBranchCtx = stmtCtx.newChild();
                const someBranchVarSym: symbol = valueDecl ? someBranchCtx.defineVar( valueDecl.name ) : Symbol("some_value_unused");

                someBranchIR = ( unConstrMatchSym ) =>  new IRApp(
                    new IRFunc([ someBranchVarSym ], someBranch.body.toIR( someBranchCtx ) ),
                    _inlineFromData(
                        getOptTypeArg( matchExprType )!,
                        _ir_apps(
                            IRNative.sndPair,
                            new IRVar( unConstrMatchSym ) // unConstrData result
                        )
                    )
                );
            }

            const noneBranchIR = this.cases.find(
                c => c.pattern.constrName === "None"
            )?.body.toIR( stmtCtx ) ?? wildcardBodyIR;

            return _ir_let(
                    _ir_apps(
                        IRNative.unConstrData,
                        this.matchExpr.toIR( ctx )
                    ),
                    unConstrMatchSym => _ir_lazyIfThenElse(
                        // condition
                        _ir_apps(
                            IRNative.equalsInteger,
                            IRConst.int( 0 ),
                            _ir_apps(
                                IRNative.fstPair,
                                new IRVar( unConstrMatchSym ) // unConstrData result
                            )
                        ),
                        // then Just{ value }
                        someBranchIR( unConstrMatchSym ),
                        // else None
                        noneBranchIR
                    )
            );
        }

        // TirDataStructType

        const stmtCtx = ctx.newChild();
        const unConstrStructSym = stmtCtx.pushUnusedVar("unconstrStruct"); // unconstrStruct
        const isConstrIdxSym = stmtCtx.pushUnusedVar("isConstrIdx"); // isConstrIdx

        const noVarsWildcardBodyIR = (
            this.wildcardCase?.body.toIR( stmtCtx )
            ?? new IRError()
        );
        const delayedNoVarWildcardBodyIR = new IRDelayed( noVarsWildcardBodyIR );
        let ifThenElseMatchingStatements: IRTerm = noVarsWildcardBodyIR;

        if(
            this.cases.some(({ pattern }) =>
                matchExprType.constructors.findIndex( ctor => ctor.name === pattern.constrName ) < 0
            )
        ) throw new Error("case expression includes unknown constructor.");

        const cases = this.cases.sort((a, b) => {
            const a_idx = matchExprType.constructors.findIndex( ctor => ctor.name === a.pattern.constrName );
            const b_idx = matchExprType.constructors.findIndex( ctor => ctor.name === b.pattern.constrName );
            return a_idx - b_idx;
        });

        for( let i = cases.length - 1; i >= 0; i-- )
        {
            const { pattern, body } = cases[i];
            const ctorIdx = matchExprType.constructors.findIndex( ctor => ctor.name === pattern.constrName );
            if( ctorIdx < 0 ) throw new Error("case expression includes unknown constructor."); // unreachable

            const ctor = matchExprType.constructors[ ctorIdx ];
            const usedFieldsCtorNames = (
                ctor.fields.map( f => f.name )
                .filter( fName => pattern.fields.has( fName ) )
            );

            if( usedFieldsCtorNames.length <= 0 ) {
                ifThenElseMatchingStatements = _ir_lazyIfThenElse(
                    // condition
                    _ir_apps(
                        new IRVar( isConstrIdxSym ), // isConstrIdx
                        IRConst.int( ctorIdx )
                    ),
                    // then
                    body.toIR( stmtCtx ),
                    // else
                    ifThenElseMatchingStatements
                );
                continue;
            }

            function indexOfField( fieldName: string ): number
            {
                const idx = ctor.fields.findIndex( f => f.name === fieldName );
                if( idx < 0 ) throw new Error("case pattern not expressified.");
                return idx;
            }

            if( usedFieldsCtorNames.length === 1 ) {
                const thenCtx = stmtCtx.newChild();

                const fName = usedFieldsCtorNames[0];

                const patternVarDecl = pattern.fields.get( fName );
                if(!( patternVarDecl instanceof TirSimpleVarDecl ))
                throw new Error("case pattern not expressified.");
                const introVar = thenCtx.defineVar( patternVarDecl.name );

                const thenCase = _ir_let_sym(
                    introVar,
                    _inlineFromData(
                        patternVarDecl.type,
                        _ir_apps(
                            IRNative.headList,
                            _ir_apps(
                                IRNative._dropList,
                                IRConst.int( indexOfField( fName ) ), // constr field index
                                _ir_apps( // fileds as data list
                                    IRNative.sndPair,
                                    new IRVar( unConstrStructSym ) // unconstrStruct
                                )
                            )
                        )
                    ),
                    body.toIR( thenCtx )
                );
                ifThenElseMatchingStatements = _ir_lazyIfThenElse(
                    // condition
                    _ir_apps(
                        new IRVar( isConstrIdxSym ), // isConstrIdx
                        IRConst.int( ctorIdx )
                    ),
                    // then
                    thenCase,
                    // else
                    ifThenElseMatchingStatements
                );
                continue;
            } // single field used edge case

            // multiple fields used
            const thenCtx = stmtCtx.newChild();
            const fieldsAsDataList = thenCtx.pushUnusedVar(); // fileds as data list

            const sortedUsedFields = [ ...usedFieldsCtorNames ].sort((a, b) =>
                indexOfField( a ) - indexOfField( b )
            );

            const introducedVars: symbol[] = new Array( sortedUsedFields.length );
            for( let fIdx = 0; fIdx < sortedUsedFields.length; fIdx++ ) {
                const fName = sortedUsedFields[fIdx]
                const patternVarDecl = pattern.fields.get( fName );
                if(!( patternVarDecl instanceof TirSimpleVarDecl ))
                throw new Error("case pattern not expressified.");
                introducedVars[fIdx] = thenCtx.defineVar( patternVarDecl.name );
            }

            const extractedFields: IRTerm[] = sortedUsedFields.map( fName =>
                _inlineFromData(
                    ctor.fields.find( f => f.name === fName )!.type,
                    _ir_apps(
                        IRNative.headList,
                        _ir_apps(
                            IRNative._dropList,
                            IRConst.int( indexOfField( fName ) ), // constr field index
                            new IRVar( fieldsAsDataList ) // fileds as data list
                        )
                    )
                )
            );
            const thenCase = _ir_let_sym(
                fieldsAsDataList,
                _ir_apps(
                    IRNative.sndPair,
                    new IRVar( unConstrStructSym ) // unconstrStruct
                ), // fileds as data list
                _ir_apps(
                    new IRFunc(
                        introducedVars,
                        body.toIR( thenCtx )
                    ),
                    ...(extractedFields as [IRTerm, IRTerm, ...IRTerm[]])
                )
            );
            ifThenElseMatchingStatements = _ir_lazyIfThenElse(
                // condition
                _ir_apps(
                    new IRVar( isConstrIdxSym ), // isConstrIdx
                    IRConst.int( ctorIdx )
                ),
                // then
                thenCase,
                // else
                ifThenElseMatchingStatements
            );
        }

        return _ir_let_sym(
            unConstrStructSym,
            _ir_apps(
                IRNative.unConstrData,
                this.matchExpr.toIR( ctx )
            ), // unconstrStruct
            _ir_let_sym(
                isConstrIdxSym,
                _ir_apps(
                    IRNative.equalsInteger,
                    _ir_apps(
                        IRNative.fstPair,
                        new IRVar( unConstrStructSym ) // unConstrData result
                    )
                ), // isConstrIdx
                ifThenElseMatchingStatements
            )
        )
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