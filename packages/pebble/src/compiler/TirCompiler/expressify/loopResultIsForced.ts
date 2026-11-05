import { IRNativeTag } from "../../../IR/IRNodes/IRNative/IRNativeTag";
import { isTirBinaryExpr, TirAddExpr, TirEqualExpr, TirGreaterThanEqualExpr, TirGreaterThanExpr, TirLessThanEqualExpr, TirLessThanExpr, TirLogicalAndExpr, TirLogicalOrExpr, TirMultExpr, TirNotEqualExpr, TirSubExpr } from "../../tir/expressions/binary/TirBinaryExpr";
import { TirLitArrExpr } from "../../tir/expressions/litteral/TirLitArrExpr";
import { TirLitFalseExpr } from "../../tir/expressions/litteral/TirLitFalseExpr";
import { TirLitHexBytesExpr } from "../../tir/expressions/litteral/TirLitHexBytesExpr";
import { TirLitIntExpr } from "../../tir/expressions/litteral/TirLitIntExpr";
import { TirLitStrExpr } from "../../tir/expressions/litteral/TirLitStrExpr";
import { TirLitTrueExpr } from "../../tir/expressions/litteral/TirLitTrueExpr";
import { TirLitVoidExpr } from "../../tir/expressions/litteral/TirLitVoidExpr";
import { TirCallExpr } from "../../tir/expressions/TirCallExpr";
import { TirCaseExpr } from "../../tir/expressions/TirCaseExpr";
import { TirElemAccessExpr } from "../../tir/expressions/TirElemAccessExpr";
import { TirExpr } from "../../tir/expressions/TirExpr";
import { TirFromDataExpr } from "../../tir/expressions/TirFromDataExpr";
import { TirFuncExpr } from "../../tir/expressions/TirFuncExpr";
import { TirInlineClosedIR } from "../../tir/expressions/TirInlineClosedIR";
import { TirIsExpr } from "../../tir/expressions/TirIsExpr";
import { TirNativeFunc } from "../../tir/expressions/TirNativeFunc";
import { TirParentesizedExpr } from "../../tir/expressions/TirParentesizedExpr";
import { TirPropAccessExpr } from "../../tir/expressions/TirPropAccessExpr";
import { TirTernaryExpr } from "../../tir/expressions/TirTernaryExpr";
import { TirToDataExpr } from "../../tir/expressions/TirToDataExpr";
import { TirTypeConversionExpr } from "../../tir/expressions/TirTypeConversionExpr";
import { TirVariableAccessExpr } from "../../tir/expressions/TirVariableAccessExpr";
import { TirUnaryExclamation } from "../../tir/expressions/unary/TirUnaryExclamation";
import { TirUnaryMinus } from "../../tir/expressions/unary/TirUnaryMinus";
import { TirUnaryPlus } from "../../tir/expressions/unary/TirUnaryPlus";
import { isTirUnaryPrefixExpr } from "../../tir/expressions/unary/TirUnaryPrefixExpr";
import { TypedProgram } from "../../tir/program/TypedProgram";
import { TirAssertStmt } from "../../tir/statements/TirAssertStmt";
import { TirAssignmentStmt } from "../../tir/statements/TirAssignmentStmt";
import { TirBlockStmt } from "../../tir/statements/TirBlockStmt";
import { TirBreakStmt } from "../../tir/statements/TirBreakStmt";
import { TirContinueStmt } from "../../tir/statements/TirContinueStmt";
import { TirForOfStmt } from "../../tir/statements/TirForOfStmt";
import { TirForStmt } from "../../tir/statements/TirForStmt";
import { TirIfStmt } from "../../tir/statements/TirIfStmt";
import { TirMatchStmt } from "../../tir/statements/TirMatchStmt";
import { TirFailStmt } from "../../tir/statements/TirFailStmt";
import { TirReturnStmt } from "../../tir/statements/TirReturnStmt";
import { TirStmt } from "../../tir/statements/TirStmt";
import { TirTraceStmt } from "../../tir/statements/TirTraceStmt";
import { TirSimpleVarDecl } from "../../tir/statements/TirVarDecl/TirSimpleVarDecl";
import { TirNamedDeconstructVarDecl } from "../../tir/statements/TirVarDecl/TirNamedDeconstructVarDecl";
import { TirSopOptT } from "../../tir/types/TirNativeType/native/Optional/sop";
import { TirDataOptT } from "../../tir/types/TirNativeType/native/Optional/data";
import { isTirVarDecl } from "../../tir/statements/TirVarDecl/TirVarDecl";
import { TirWhileStmt } from "../../tir/statements/TirWhileStmt";
import { TirAliasType } from "../../tir/types/TirAliasType";
import { TirBytesT } from "../../tir/types/TirNativeType/native/bytes";
import { TirFuncT } from "../../tir/types/TirNativeType/native/function";
import { TirIntT } from "../../tir/types/TirNativeType/native/int";
import { TirLinearMapT } from "../../tir/types/TirNativeType/native/linearMap";
import { TirListT } from "../../tir/types/TirNativeType/native/list";
import { TirInterfaceType } from "../../tir/types/TirInterfaceType";
import { TirType } from "../../tir/types/TirType";
import { TirTypeParam } from "../../tir/types/TirTypeParam";
import { getUnaliased } from "../../tir/types/utils/getUnaliased";

/**
 * Whether running `stmts`, the statements after a loop, certainly computes the value `varName`
 * holds when they start.
 *
 * The bare loop lowering binds the loop's result as a letted value, and a letted value is
 * computed only where it is used: the loop, and every `assert` in its body, runs only if the
 * result is. A read counts when nothing can skip it: a `return` value, an `assert` or `if`
 * condition, a `match` scrutinee, outside the right side of `&&` / `||`, the branches of `?:` and
 * the arguments of functions other than builtins, before any branch, loop or early exit, and
 * before `varName` is assigned a value that does not use it. Reads of a `const` (or an assigned
 * variable) whose value certainly reads `varName` count too. A `trace` never counts: it may be
 * stripped (`removeTraces`).
 *
 * Masterpiece BUG 26 was the result never being read; a result read only in one branch, only by
 * an unused `const`, or overwritten first dropped the loop the same way.
 */
export function loopResultIsForced( stmts: readonly TirStmt[], varName: string, program: TypedProgram ): boolean
{
    // the variables whose value certainly computes the loop's result when computed
    const forcing = new Set<string>([ varName ]);
    const reads = ( expr: TirExpr ) => strictlyReads( expr, forcing, program );
    const queue = stmts.slice();
    let stmt: TirStmt | undefined;
    while( ( stmt = queue.shift() ) !== undefined )
    {
        if( forcing.size === 0 ) return false;

        if( stmt instanceof TirReturnStmt ) return reads( stmt.value );
        if( stmt instanceof TirIfStmt ) return reads( stmt.condition );
        if( stmt instanceof TirMatchStmt ) return reads( stmt.matchExpr );
        if( stmt instanceof TirAssertStmt )
        {
            if( reads( stmt.condition ) ) return true;
            continue;
        }
        if( stmt instanceof TirTraceStmt ) continue;
        if( stmt instanceof TirBlockStmt )
        {
            queue.unshift( ...stmt.stmts );
            continue;
        }
        if( isTirVarDecl( stmt ) )
        {
            const forces = stmt.initExpr !== undefined && reads( stmt.initExpr );
            for( const name of stmt.introducedVars() )
            {
                if( forces ) forcing.add( name );
                else forcing.delete( name );
            }
            continue;
        }
        if( stmt instanceof TirAssignmentStmt )
        {
            const name = stmt.varIdentifier.varName;
            if( reads( stmt.assignedExpr ) ) forcing.add( name );
            else forcing.delete( name );
            continue;
        }

        // a loop, `fail`, `break` or `continue`
        return false;
    }
    // falling off the end: the value is only part of the state a branch or loop body passes on
    return false;
}

/**
 * Whether every way through `stmts` (what runs after the declaration of the user `const`
 * `varName`, to the end of its function) computes `varName`. The letted placement computes it
 * once, at the first point all its reads go through (where they meet, the lowest common
 * ancestor of the references), so:
 * - a read counts where `loopResultIsForced` counts one;
 * - a statement or expression whose parts (the branches of an `if`, `match` or `?:`, the two
 *   sides of `&&`, and what follows an `if` or `match`) hold reads in two or more of them
 *   computes it, before the parts; with reads in one part only, every way must go through
 *   that part and compute it there;
 * - a loop or a closure reading it computes it: it is computed once before them, even when
 *   the body never runs (the compute-once rescue).
 * A way that fails (`fail`) needs no read: the run fails anyway.
 */
export function readOnEveryPath(
    stmts: readonly TirStmt[],
    varName: string,
    program: TypedProgram,
    /** the function of the program's code a call calls: an argument is read when it reads its parameter on every way */
    userFunction: ( call: TirCallExpr ) => { fn: TirFuncExpr, isMethod: boolean } | undefined
): boolean
{
    return everyWayReads( stmts.slice(), new Set([ varName ]), program, { userFunction, paramReads: new Map() } );
}

/** how a user `const`'s reads are found (see `readOnEveryPath`) */
interface UserConstReads {
    readonly userFunction: ( call: TirCallExpr ) => { fn: TirFuncExpr, isMethod: boolean } | undefined;
    /** whether each function reads each parameter on every way; `false` while being found (recursion) */
    readonly paramReads: Map<TirFuncExpr, Map<number, boolean>>;
}

function everyWayReads( queue: TirStmt[], forcing: Set<string>, program: TypedProgram, rules: UserConstReads ): boolean
{
    const reads = ( expr: TirExpr ) => exprComputes( expr, forcing, program, rules );
    const holds = ( parts: readonly any[] ) => parts.some( p => readsAnyOf( p, forcing ) );
    const branch = ( s: TirStmt | undefined ): TirStmt[] => s === undefined ? [] : s instanceof TirBlockStmt ? s.stmts.slice() : [ s ];
    let stmt: TirStmt | undefined;
    while( ( stmt = queue.shift() ) !== undefined )
    {
        if( forcing.size === 0 ) return false;

        if( stmt instanceof TirReturnStmt ) return stmt.value !== undefined && reads( stmt.value );
        if( stmt instanceof TirFailStmt ) return true;
        if( stmt instanceof TirAssertStmt )
        {
            if( reads( stmt.condition ) ) return true;
            continue;
        }
        if( stmt instanceof TirIfStmt )
        {
            if( reads( stmt.condition ) ) return true;
            const ways = [ branch( stmt.thenBranch ), branch( stmt.elseBranch ) ];
            // reads in two of the branches and what follows: they meet here
            if( [ ...ways, queue ].filter( holds ).length >= 2 ) return true;
            return ways.every( way => everyWayReads( [ ...way, ...queue ], new Set( forcing ), program, rules ) );
        }
        if( stmt instanceof TirMatchStmt )
        {
            if( reads( stmt.matchExpr ) ) return true;
            // a value no case matches fails
            const ways = [ ...stmt.cases.map( c => c.body ), ...( stmt.wildcardCase ? [ stmt.wildcardCase.body ] : [] ) ].map( branch );
            if( [ ...ways, queue ].filter( holds ).length >= 2 ) return true;
            return ways.every( way => everyWayReads( [ ...way, ...queue ], new Set( forcing ), program, rules ) );
        }
        if( stmt instanceof TirTraceStmt ) continue;
        if( stmt instanceof TirBlockStmt )
        {
            queue.unshift( ...stmt.stmts );
            continue;
        }
        if( isTirVarDecl( stmt ) )
        {
            const forces = stmt.initExpr !== undefined && reads( stmt.initExpr );
            // a constructor's pattern checks the value where it is declared
            if( forces && stmt instanceof TirNamedDeconstructVarDecl && constructorCount( stmt.type ) > 1 ) return true;
            for( const name of stmt.introducedVars() )
            {
                if( forces ) forcing.add( name );
                else forcing.delete( name );
            }
            continue;
        }
        if( stmt instanceof TirAssignmentStmt )
        {
            const name = stmt.varIdentifier.varName;
            if( reads( stmt.assignedExpr ) ) forcing.add( name );
            else forcing.delete( name );
            continue;
        }
        if( stmt instanceof TirForStmt || stmt instanceof TirWhileStmt || stmt instanceof TirForOfStmt )
        {
            // computed before the loop, whatever its body reads it for
            if( readsAnyOf( stmt, forcing ) ) return true;
            // what the body assigns may hold anything after it
            for( const name of assignedNames( stmt ) ) forcing.delete( name );
            continue;
        }

        // `break`, `continue`: not outside a loop body
        return false;
    }
    // the end of the function (a contract method, a function returning nothing)
    return false;
}

/**
 * whether computing `expr` certainly reads one of `names`; with `rules`, as the compiler computes
 * a user `const`: a closure reading one counts (the value is computed before the lambda), and
 * so does an argument of a function of the program's code that reads its parameter on every way
 */
function strictlyReads( expr: TirExpr, names: ReadonlySet<string>, program: TypedProgram, rules?: UserConstReads ): boolean
{
    const reads = ( e: TirExpr ) => strictlyReads( e, names, program, rules );
    if( expr instanceof TirVariableAccessExpr ) return names.has( expr.varName );
    if( expr instanceof TirFuncExpr ) return rules !== undefined && readsAnyOf( expr, names );
    if(
        expr instanceof TirParentesizedExpr
        || expr instanceof TirTypeConversionExpr
        || expr instanceof TirToDataExpr
    ) return reads( expr.expr );
    if( expr instanceof TirFromDataExpr ) return reads( expr.dataExpr );
    // the right side is computed only for some values of the left one
    if( expr instanceof TirLogicalAndExpr || expr instanceof TirLogicalOrExpr ) return reads( expr.left );
    if( isTirBinaryExpr( expr ) ) return reads( expr.left ) || reads( expr.right );
    if( isTirUnaryPrefixExpr( expr ) ) return reads( expr.operand );
    // a branch is computed only for some values of the condition: both, or the condition
    if( expr instanceof TirTernaryExpr ) return reads( expr.condition ) || ( reads( expr.ifTrue ) && reads( expr.ifFalse ) );
    if( expr instanceof TirIsExpr ) return reads( expr.instanceExpr );
    if( expr instanceof TirCaseExpr ) return reads( expr.matchExpr ) || (
        expr.cases.every( c => reads( c.body ) ) && ( expr.wildcardCase === undefined || reads( expr.wildcardCase.body ) )
    );
    if( expr instanceof TirPropAccessExpr ) return reads( expr.object );
    if( expr instanceof TirElemAccessExpr ) return reads( expr.arrLikeExpr ) || reads( expr.indexExpr );
    if( expr instanceof TirCallExpr )
    {
        const tag = builtinCalled( expr, program );
        if( tag !== undefined && !LAZY_BUILTINS.has( tag ) ) return expr.args.some( reads );
        const receiver = builtinMethodReceiver( expr );
        if( receiver !== undefined && reads( receiver ) ) return true;
        if( rules === undefined ) return false;
        if( expr.args.some( a => a instanceof TirFuncExpr && reads( a ) ) ) return true;
        const called = rules.userFunction( expr );
        if( called === undefined ) return false;
        // a method's receiver is its first parameter
        const passed: TirExpr[] = called.isMethod && expr.func instanceof TirPropAccessExpr ? [ expr.func.object, ...expr.args ] : expr.args;
        return passed.some( ( a, i ) => reads( a ) && readsParam( called.fn, i, program, rules ) );
    }
    // literals (a known constructor's fields are taken apart lazily), function values, the
    // arguments of a function (inlined, an unused parameter is dropped with its argument)
    return false;
}

/**
 * whether computing `expr` computes the user `const` whose reads are `names` (see
 * `readOnEveryPath`): a read that nothing can skip, or reads in two of its parts, which meet
 * here, or in one part computed whenever `expr` is, that computes it
 */
function exprComputes( expr: TirExpr, names: ReadonlySet<string>, program: TypedProgram, rules: UserConstReads ): boolean
{
    if( strictlyReads( expr, names, program, rules ) ) return true;
    const withReads = exprParts( expr, program, rules ).filter( p => readsAnyOf( p.expr, names ) );
    if( withReads.length >= 2 ) return true;
    return withReads.length === 1 && withReads[0].always && exprComputes( withReads[0].expr, names, program, rules );
}

/** the parts of `expr`, and whether each is computed whenever `expr` is */
function exprParts( expr: TirExpr, program: TypedProgram, rules: UserConstReads ): { expr: TirExpr, always: boolean }[]
{
    const always = ( e: TirExpr ) => ({ expr: e, always: true });
    const sometimes = ( e: TirExpr ) => ({ expr: e, always: false });
    if( expr instanceof TirTernaryExpr ) return [ always( expr.condition ), sometimes( expr.ifTrue ), sometimes( expr.ifFalse ) ];
    if( expr instanceof TirLogicalAndExpr || expr instanceof TirLogicalOrExpr ) return [ always( expr.left ), sometimes( expr.right ) ];
    if( expr instanceof TirCaseExpr ) return [
        always( expr.matchExpr ),
        ...expr.cases.map( c => sometimes( c.body ) ),
        ...( expr.wildcardCase ? [ sometimes( expr.wildcardCase.body ) ] : [] ),
    ];
    if( isTirBinaryExpr( expr ) ) return [ always( expr.left ), always( expr.right ) ];
    if( isTirUnaryPrefixExpr( expr ) ) return [ always( expr.operand ) ];
    if(
        expr instanceof TirParentesizedExpr
        || expr instanceof TirTypeConversionExpr
        || expr instanceof TirToDataExpr
    ) return [ always( expr.expr ) ];
    if( expr instanceof TirFromDataExpr ) return [ always( expr.dataExpr ) ];
    if( expr instanceof TirIsExpr ) return [ always( expr.instanceExpr ) ];
    if( expr instanceof TirPropAccessExpr ) return [ always( expr.object ) ];
    if( expr instanceof TirElemAccessExpr ) return [ always( expr.arrLikeExpr ), always( expr.indexExpr ) ];
    if( expr instanceof TirCallExpr )
    {
        const tag = builtinCalled( expr, program );
        if( tag !== undefined ) return expr.args.map( a => LAZY_BUILTINS.has( tag ) ? sometimes( a ) : always( a ) );
        const called = rules.userFunction( expr );
        const passed: TirExpr[] = called?.isMethod && expr.func instanceof TirPropAccessExpr ? [ expr.func.object, ...expr.args ] : expr.args;
        return [
            ...( called?.isMethod ? [] : [ always( expr.func ) ] ),
            // an argument is computed when the function reads its parameter on every way
            ...passed.map( ( a, i ) => called !== undefined && readsParam( called.fn, i, program, rules ) ? always( a ) : sometimes( a ) ),
        ];
    }
    return [];
}

/** whether every way through `fn`'s body reads its parameter `i` (see `readOnEveryPath`) */
function readsParam( fn: TirFuncExpr, i: number, program: TypedProgram, rules: UserConstReads ): boolean
{
    let known = rules.paramReads.get( fn );
    if( known === undefined ) rules.paramReads.set( fn, known = new Map() );
    const memo = known.get( i );
    if( memo !== undefined ) return memo;
    known.set( i, false );
    const param = fn.params[i];
    const result = param !== undefined && everyWayReads( fn.body.stmts.slice(), new Set([ param.name ]), program, rules );
    known.set( i, result );
    return result;
}

/** how many constructors a value of `type` may have been built with */
function constructorCount( type: TirType ): number
{
    const t = getUnaliased( type );
    if( t instanceof TirSopOptT || t instanceof TirDataOptT ) return 2;
    const constructors = ( t as any )?.constructors;
    return Array.isArray( constructors ) ? constructors.length : 1;
}

/** builtins the compiler may turn into a `case` whose branches are computed only when taken */
const LAZY_BUILTINS: ReadonlySet<IRNativeTag> = new Set([
    IRNativeTag.strictIfThenElse,
    IRNativeTag.chooseUnit,
    IRNativeTag.trace,
    IRNativeTag.strictChooseList,
    IRNativeTag.chooseData,
]);

/** the UPLC builtin the call applies (`std.bytes.concat( a, b )`): it computes all its arguments */
function builtinCalled( call: TirCallExpr, program: TypedProgram ): IRNativeTag | undefined
{
    const callee = call.func;
    const tag = callee instanceof TirNativeFunc ? callee.tag
        : callee instanceof TirVariableAccessExpr ? builtinTagOf( program.functions.get( callee.varName ) )
        : undefined;
    // negative tags are the compiler's own functions
    return tag !== undefined && tag >= 0 ? tag : undefined;
}

function builtinTagOf( fn: TirExpr | undefined ): IRNativeTag | undefined
{
    return fn instanceof TirInlineClosedIR ? fn.builtinTag : undefined;
}

/**
 * The receiver of a call to a method of a standard type (`xs.head()`, `bs.length()`), which
 * compiles to builtins that compute it. A method an alias declares is a function of its own and
 * may not use `this`.
 */
function builtinMethodReceiver( call: TirCallExpr ): TirExpr | undefined
{
    const access = call.func;
    if(!( access instanceof TirPropAccessExpr )) return undefined;
    let type: TirType = access.object.type;
    while( type instanceof TirAliasType )
    {
        if( type.methodsNamesPtr.has( access.prop.text ) ) return undefined;
        type = type.aliased;
    }
    if(
        type instanceof TirTypeParam
        || type instanceof TirInterfaceType
        || type instanceof TirFuncT
    ) return undefined;
    return access.object;
}

/**
 * Whether running `loop` can never fail and certainly ends: dropping it then changes nothing (but
 * the budget), so its result may be bound lazily whether or not it is used. An endless loop fails
 * (out of budget), so only a `for...of` (lists are finite) or a `for` counting up (or down) to a
 * bound its body changes neither ends for sure. Recognizes loops made of variable reads, literals,
 * integer `+ - *`, byte appends, comparisons, list `prepend` / `length` / `isEmpty`, and the
 * builtins in `TOTAL_BUILTINS`; a `trace` is ignored (its message is not part of the stripped
 * script, and a lowering must not depend on traces).
 */
export function loopCannotFail( loop: TirForStmt | TirWhileStmt | TirForOfStmt, program: TypedProgram ): boolean
{
    return stmtCannotFail( loop, program );
}

/** a `for...of`, or `for( let i = a; i < b; i = i + k )` (or `>`, `- k`) with `b` unchanged by the loop */
function loopEnds( loop: TirStmt ): boolean
{
    if( loop instanceof TirForOfStmt ) return true;
    if(
        !( loop instanceof TirForStmt )
        || loop.init.length !== 1
        || loop.condition === undefined
        || loop.update?.length !== 1
    ) return false;
    const counter = loop.init[0].name;
    const update = loop.update[0];
    if(
        !( update instanceof TirAssignmentStmt )
        || update.varIdentifier.varName !== counter
    ) return false;
    const step = counterStep( update.assignedExpr, counter );
    const condition = unwrapParentheses( loop.condition );
    const countsUp = condition instanceof TirLessThanExpr || condition instanceof TirLessThanEqualExpr;
    const countsDown = condition instanceof TirGreaterThanExpr || condition instanceof TirGreaterThanEqualExpr;
    if( !( ( countsUp && step > 0 ) || ( countsDown && step < 0 ) ) ) return false;
    const left = unwrapParentheses( ( condition as TirLessThanExpr ).left );
    if( !( left instanceof TirVariableAccessExpr ) || left.varName !== counter ) return false;
    const assigned = assignedNames( loop.body );
    if( assigned.has( counter ) ) return false;
    assigned.add( counter );
    return !readsAnyOf( ( condition as TirLessThanExpr ).right, assigned );
}

/** `k` for `counter + k`, `-k` for `counter - k` (`k` a positive literal), `0` otherwise */
function counterStep( expr: TirExpr, counter: string ): number
{
    expr = unwrapParentheses( expr );
    const isCounter = ( e: TirExpr ) => {
        e = unwrapParentheses( e );
        return e instanceof TirVariableAccessExpr && e.varName === counter;
    };
    const positive = ( e: TirExpr ) => {
        e = unwrapParentheses( e );
        return e instanceof TirLitIntExpr && e.integer > BigInt( 0 );
    };
    if( expr instanceof TirAddExpr )
    {
        if( isCounter( expr.left ) && positive( expr.right ) ) return 1;
        if( positive( expr.left ) && isCounter( expr.right ) ) return 1;
    }
    if( expr instanceof TirSubExpr && isCounter( expr.left ) && positive( expr.right ) ) return -1;
    return 0;
}

function unwrapParentheses( expr: TirExpr ): TirExpr
{
    while( expr instanceof TirParentesizedExpr ) expr = expr.expr;
    return expr;
}

/** the variables `stmt` assigns, in nested statements too */
function assignedNames( stmt: any, names: Set<string> = new Set() ): Set<string>
{
    if( stmt instanceof TirAssignmentStmt ) names.add( stmt.varIdentifier.varName );
    for( const child of tirChildren( stmt ) )
    {
        if( typeof child.toIR !== "function" ) assignedNames( child, names );
    }
    return names;
}

/** whether `node` reads any of `names`, anywhere in it */
function readsAnyOf( node: any, names: ReadonlySet<string> ): boolean
{
    if( node instanceof TirVariableAccessExpr ) return names.has( node.varName );
    return tirChildren( node ).some( child => readsAnyOf( child, names ) );
}

/** the TIR nodes (they have `deps`) directly held by `node`: its fields, their arrays' and maps' elements */
function tirChildren( node: any ): any[]
{
    const children: any[] = [];
    for( const value of Object.values( node ) )
    {
        const values = Array.isArray( value ) ? value
            : value instanceof Map ? [ ...value.values() ]
            : [ value ];
        for( const v of values )
        {
            if( typeof v === "object" && v !== null && typeof v.deps === "function" ) children.push( v );
        }
    }
    return children;
}

function stmtCannotFail( stmt: TirStmt, program: TypedProgram ): boolean
{
    const total = ( e: TirExpr ) => exprCannotFail( e, program );
    const totalStmt = ( s: TirStmt ) => stmtCannotFail( s, program );
    if( stmt instanceof TirBlockStmt ) return stmt.stmts.every( totalStmt );
    if( stmt instanceof TirSimpleVarDecl ) return stmt.initExpr === undefined || total( stmt.initExpr );
    if( stmt instanceof TirAssignmentStmt ) return total( stmt.assignedExpr );
    if( stmt instanceof TirIfStmt ) return total( stmt.condition ) && totalStmt( stmt.thenBranch ) && ( stmt.elseBranch === undefined || totalStmt( stmt.elseBranch ) );
    if( stmt instanceof TirTraceStmt || stmt instanceof TirBreakStmt || stmt instanceof TirContinueStmt ) return true;
    if( stmt instanceof TirForStmt ) return (
        loopEnds( stmt )
        && stmt.init.every( totalStmt )
        && ( stmt.condition === undefined || total( stmt.condition ) )
        && ( stmt.update ?? [] ).every( totalStmt )
        && totalStmt( stmt.body )
    );
    // a pattern may not match the element
    if( stmt instanceof TirForOfStmt ) return (
        stmt.elemDeclaration instanceof TirSimpleVarDecl
        && total( stmt.iterable )
        && totalStmt( stmt.body )
    );
    // `while` (may not end), `assert`, `fail`, `return`, `match`, deconstructions
    return false;
}

/** builtins defined for every argument of their type */
const TOTAL_BUILTINS: ReadonlySet<IRNativeTag> = new Set([
    IRNativeTag.addInteger,
    IRNativeTag.subtractInteger,
    IRNativeTag.multiplyInteger,
    IRNativeTag.equalsInteger,
    IRNativeTag.lessThanInteger,
    IRNativeTag.lessThanEqualInteger,
    IRNativeTag.appendByteString,
    IRNativeTag.sliceByteString,
    IRNativeTag.lengthOfByteString,
    IRNativeTag.equalsByteString,
    IRNativeTag.lessThanByteString,
    IRNativeTag.lessThanEqualsByteString,
    IRNativeTag.sha2_256,
    IRNativeTag.sha3_256,
    IRNativeTag.blake2b_256,
    IRNativeTag.blake2b_224,
    IRNativeTag.keccak_256,
    IRNativeTag.appendString,
    IRNativeTag.equalsString,
    IRNativeTag.encodeUtf8,
    IRNativeTag.mkCons,
    IRNativeTag.nullList,
    IRNativeTag.iData,
    IRNativeTag.bData,
    IRNativeTag.equalsData,
    IRNativeTag.serialiseData,
]);

function exprCannotFail( expr: TirExpr, program: TypedProgram ): boolean
{
    const total = ( e: TirExpr ) => exprCannotFail( e, program );
    if(
        expr instanceof TirVariableAccessExpr
        || expr instanceof TirLitIntExpr
        || expr instanceof TirLitTrueExpr
        || expr instanceof TirLitFalseExpr
        || expr instanceof TirLitHexBytesExpr
        || expr instanceof TirLitStrExpr
        || expr instanceof TirLitVoidExpr
    ) return true;
    if( expr instanceof TirLitArrExpr ) return expr.elems.every( total );
    if( expr instanceof TirParentesizedExpr ) return total( expr.expr );
    if( isTirBinaryExpr( expr ) )
    {
        if( !total( expr.left ) || !total( expr.right ) ) return false;
        const operandType = getUnaliased( expr.left.type );
        const isInt = operandType instanceof TirIntT;
        // division, modulo, exponents (negative ones fail), shifts and bitwise operators (on
        // integers they convert to bytes) are not recognized
        return (
            expr instanceof TirLogicalAndExpr
            || expr instanceof TirLogicalOrExpr
            || expr instanceof TirEqualExpr
            || expr instanceof TirNotEqualExpr
            || ( ( isInt || operandType instanceof TirBytesT ) && (
                expr instanceof TirAddExpr
                || expr instanceof TirLessThanExpr
                || expr instanceof TirLessThanEqualExpr
                || expr instanceof TirGreaterThanExpr
                || expr instanceof TirGreaterThanEqualExpr
            ) )
            || ( isInt && ( expr instanceof TirSubExpr || expr instanceof TirMultExpr ) )
        );
    }
    if( expr instanceof TirUnaryExclamation || expr instanceof TirUnaryMinus || expr instanceof TirUnaryPlus ) return total( expr.operand );
    if( expr instanceof TirTernaryExpr ) return total( expr.condition ) && total( expr.ifTrue ) && total( expr.ifFalse );
    if( expr instanceof TirCallExpr )
    {
        const tag = builtinCalled( expr, program );
        if( tag !== undefined ) return TOTAL_BUILTINS.has( tag ) && expr.args.every( total );
        // `xs.prepend( x )`, `xs.length()`, `xs.isEmpty()` on lists, `bs.length()` (on bytes,
        // `prepend` is `consByteString`, which fails out of 0..255)
        const receiver = builtinMethodReceiver( expr );
        if( receiver === undefined ) return false;
        const method = ( expr.func as TirPropAccessExpr ).prop.text;
        const receiverType = getUnaliased( receiver.type );
        const isList = receiverType instanceof TirListT || receiverType instanceof TirLinearMapT;
        return (
            (
                ( isList && ( method === "prepend" || method === "length" || method === "isEmpty" ) )
                || ( receiverType instanceof TirBytesT && method === "length" )
            )
            && total( receiver )
            && expr.args.every( total )
        );
    }
    return false;
}
