import { IRApp } from "../../../IRNodes/IRApp";
import { IRCase } from "../../../IRNodes/IRCase";
import { IRFunc } from "../../../IRNodes/IRFunc";
import { getSortedLettedSet, getLettedTerms, IRLetted } from "../../../IRNodes/IRLetted";
import { IRVar } from "../../../IRNodes/IRVar";
import { IRTerm } from "../../../IRTerm";
import { _addDepths } from "../../_internal/_addDepth";
import { _modifyChildFromTo } from "../../_internal/_modifyChildFromTo";
import { findAllNoHoisted } from "../../_internal/findAll";
import { getMaxScope, getUnboundedVars } from "./groupByScope";
import { IRDelayed } from "../../../IRNodes/IRDelayed";
import { IRForced as IRForced_ } from "../../../IRNodes/IRForced";
import { IRHoisted } from "../../../IRNodes/IRHoisted";
import { iterTree } from "../../_internal/iterTree";
import { lowestCommonAncestor } from "../../_internal/lowestCommonAncestor";
import { isIRTerm } from "../../../utils/isIRTerm";
import { markRecursiveHoistsAsForced } from "../markRecursiveHoistsAsForced";
import { IRConst } from "../../../IRNodes/IRConst";
import { equalIrHash, irHashToHex } from "../../../IRHash";
import { sanifyTree } from "../sanifyTree";
import { IRRecursive } from "../../../IRNodes/IRRecursive";
import { IRSelfCall } from "../../../IRNodes/IRSelfCall";
import { findHighestRecursiveParent } from "./findHighestRecursiveParent";
import { isSafeToEagerlyEvaluate, containsExpensiveWork } from "./isSafeToFloatOutOfLambda";
import { IRParentTerm } from "../../../utils/isIRParentTerm";
import { IRNative } from "../../../IRNodes/IRNative";
import { isForcedNativeTag } from "../../../IRNodes/IRNative/isForcedNative";
import { lettedToStr, prettyIRInline } from "../../../utils/showIR";
import { IRNativeTag } from "../../../IRNodes/IRNative/IRNativeTag";

let __handleLettedCallN = 0;
export function handleLettedAndReturnRoot( term: IRTerm ): IRTerm
{
    __handleLettedCallN++;
    // console.log(" ------------------------------------------- handleLetted ------------------------------------------- ");
    // console.log( prettyIRText( term ))
    // most of the time we are just compiling small
    // pre-execuded terms (hence constants)
    if( term instanceof IRConst ) return term;

    sanifyTree( term );
    
    // TODO: should probably merge `markRecursiveHoistsAsForced` inside `getLettedTerms` to iter once
    markRecursiveHoistsAsForced( term );

    // Normalize away REDUNDANT `IRForced` wrappers over (possibly letted /
    // hoisted) forced-tag natives. An `IRNative` with a forced tag already
    // denotes the ready-to-apply function — the required UPLC `force`s are
    // materialized by `ensureProperlyForcedBuiltins` at each concrete
    // builtin occurrence. Keeping an extra `IRForced( IRLetted( native ) )`
    // alias means that once the shared native binding is made pre-forced,
    // the alias forces it a SECOND time and the machine/node fail with
    // "cannot force builtin ... that has already received all its
    // arguments" (found as an on-chain miscompilation in this repo).
    iterTree( term, ( node: IRTerm ) => {
        if( node instanceof IRForced_ )
        {
            let inner: IRTerm = node.forced;
            while(
                inner instanceof IRLetted
                || inner instanceof IRHoisted
            ) inner = inner instanceof IRLetted ? inner.value : inner.hoisted;
            if(
                inner instanceof IRNative
                && isForcedNativeTag( inner.tag )
            ) {
                _modifyChildFromTo(
                    node.parent,
                    node,
                    node.forced
                );
                return true;
            }
        }
        return undefined;
    });

    // in case there are no letted terms there is no work to do
    while( true )
    {
        // console.log(` ------------------ letted loop ------------------ `);

        const allDirectLetted = getLettedTerms( term, { all: false, includeHoisted: false });
        if( allDirectLetted.length === 0 ) return term;

        // // console.log("allDirectLetted", allDirectLetted.map( expandedJsonLettedSetEntry ) );
        
        const sortedLettedSet = getSortedLettedSet( allDirectLetted );

        // console.log("sortedLettedSet", sortedLettedSet.map( expandedJsonLettedSetEntry ) );

        // `sortedLettedSet` is sorted from least to most dependencies
        // so we'll have "0 dependencies" letted terms at the start of the array
        // and "n dependencies" letted terms at the end of the array
        // 
        // we process the "most dependent" terms first
        // so their values are inlined
        // and later, its dependencies will be replaced with `IRVar`
        // whereever these dependent are inlined
        //
        // hence why `pop` (and not `shift`)
        const {
            letted,
            nReferences
        } = sortedLettedSet.pop()!;

        // const shouldLog = (
        //     letted.value instanceof IRApp
        //     && letted.value.fn instanceof IRNative
        //     && letted.value.fn.tag === IRNativeTag.addInteger
        //     && letted.value.arg instanceof IRConst
        //     && letted.value.arg.value === -1n
        // )
        // shouldLog && // console.log("nReferences", nReferences);

        // console.log(` ------------------ working with ${lettedToStr(letted)} ------------------ `);
        // console.log(` ------------------ working with ${lettedToStr(letted)} ------------------ `);
        // if( shouldLog ) {
        //     console.log( prettyIRInline( letted ) );
        // }

        // TOTAL values are FLOATED OUT of enclosing lambdas / loop bodies
        // during placement, so a closure only ever accesses evaluated
        // CONSTANTS (bound variables) — never a computation re-run per
        // call (found in the wild: sha256-of-8KB re-ran 128 times, ~24B
        // CPU steps). Only values that can NEVER fail qualify — floating a
        // partial computation (field extractors etc.) out of a closure that
        // might not run is the bug-12 class of miscompilation, so those
        // keep their lazy in-closure placement.
        const canFloatOutOfLambda =
            !(
                // trivial values: inlining is strictly better
                letted.value instanceof IRVar
                || letted.value instanceof IRConst
                || letted.value instanceof IRNative
                || letted.value instanceof IRSelfCall
            )
            && isSafeToEagerlyEvaluate( letted.value );

        // decode-once field extractors (per-use-site source semantics)
        // that CAN FAIL: sharing them is only allowed where a spine
        // witness proves evaluation-order neutrality (see hasSpineWitness)
        const siteScopedPartial =
            letted.meta.siteScoped === true
            && !isSafeToEagerlyEvaluate( letted.value );


        if( process.env.PEBBLE_DBG_ALL )
            console.error( "[pop]", __handleLettedCallN, letted.name.description, nReferences );
        if( process.env.PEBBLE_DBG_PLACE
            && String( letted.name.description ).includes( process.env.PEBBLE_DBG_PLACE ) )
        {
            const chain: string[] = [];
            let t: IRTerm | undefined = letted as IRTerm;
            while( t && chain.length < 28 ) {
                const p = t.parent as IRTerm | undefined;
                if( !p ) break;
                let d = p.constructor.name;
                if( p instanceof IRFunc ) d += "(" + p.params.map( x => x.description ).join(",") + ")";
                if( p instanceof IRCase && t !== (p as IRCase).constrTerm ) d += "[branch]";
                chain.push( d );
                t = p;
            }
            console.error( "[place]", "call#" + __handleLettedCallN, letted.name.description, "nRefs:", nReferences,
                "underBinder:", refUnderBinderOf( letted, letted.name ),
                "chain:", chain.join(" < ") );
        }
        const wasSingleReferenceButRecursive = nReferences <= 1;

        // late-surfacing instance of an ALREADY-BOUND letted: reuse the
        // enclosing binding instead of re-evaluating (see refUnderBinderOf)
        if(
            wasSingleReferenceButRecursive
            && refUnderBinderOf( letted, letted.name )
        ) {
            _modifyChildFromTo(
                letted.parent,
                letted,
                new IRVar( letted.name )
            );
            continue;
        }

        if(
            wasSingleReferenceButRecursive // nReferences <= 1
            && ( !someParentIsRecursive( letted )
                // a site-scoped partial keeps its per-site placement even
                // under recursion: hoisting to a branch root evaluates it
                // eagerly on paths that may never reach the use site
                || siteScopedPartial )
            // floatable values go through placement instead: inlining would
            // keep them inside the closure at the use site
            && !canFloatOutOfLambda
        ) {
            if( process.env.PEBBLE_DBG_ALL ) console.error( "[pop]   -> single-ref inline" );
            _modifyChildFromTo(
                letted.parent,
                letted,
                letted.value
            );
            continue;
        }


        // console.log("--------- not inilning ("+ nReferences +" references)");

        // The nearest ancestor that BINDS one of the value's free vars —
        // the highest position this instance's binding could ever sit.
        // NOTE: unlike `getMaxScope` this deliberately does NOT stop at
        // `IRDelayed`: loop continuations are delayed, and stopping there
        // split one value used in two sequential loop tails into singleton
        // groups that each got INLINED (measured: 226 such re-evaluations
        // in the masterpiece contract, incl. duplicate sha256 chains).
        // Cross-delay sharing is placement-checked below (spine witness
        // for partial values).
        const unboundedForAnchor = getUnboundedVars( letted.value );
        const anchorOf = ( ref: IRTerm ): IRTerm => {
            let t: IRTerm | undefined = ref.parent as IRTerm | undefined;
            while( t )
            {
                if(
                    ( t instanceof IRFunc || t instanceof IRRecursive )
                    && t.params.some( p => unboundedForAnchor.has( p ) )
                ) return t;
                t = t.parent as IRTerm | undefined;
            }
            return term;
        };
        const myAnchor = anchorOf( letted as IRTerm );

        const maxScope = myAnchor;
        // const maxScope = getMaxScope( letted ) ?? ((): IRTerm => {
        //     if( letted.meta.isClosed || isClosedTerm( letted.value ) )
        //     {
        //         // value is closed (hoisted),
        //         // so the max scope is the entire script
        //         return term;
        //     }
        //     else throw new Error(
        //         `could not find a max scope for letted value with hash ${irHashToHex(letted.hash)}`
        //     );
        // })();

        const lettedTermCanBeHoisted = maxScope === term;

        const minScope = findHighestRecursiveParent( letted, maxScope );
        
        sanifyTree( maxScope );
        const lettedHash = letted.hash;

        // collect references GLOBALLY: `maxScope` stops at the first
        // enclosing binder of a free var OR the first IRDelayed — loop
        // continuations are delayed, so a value used in two sequential
        // loop tails split into singleton groups that each got INLINED
        // (measured: 226 such inlines in the masterpiece contract,
        // re-running whole decode chains and sha256 calls per use).
        // Placement safety does not need the pre-filter: the climb stops
        // at free-var binders and case-branch edges, and PARTIAL values
        // fall back to per-reference inlining unless a spine witness
        // proves evaluation-order neutrality.
        const sameLettedRefs = ( findAllNoHoisted(
            term,
            node => 
                node instanceof IRLetted &&
                equalIrHash( node.hash, lettedHash )
        ) as IRLetted[] )
        .filter( ref => {
            // EXCLUDE instances nested inside ANOTHER letted's VALUE: not
            // attached to their final position yet — replacing them with a
            // variable can leave them outside the binder's scope once the
            // containing value is placed. They surface as ordinary tree
            // references after their container is placed (late singletons
            // under the already-placed binder are caught by
            // `refUnderBinderOf`).
            let t: IRTerm | undefined = ( ref as IRTerm ).parent as IRTerm | undefined;
            while( t )
            {
                if( t instanceof IRLetted ) return false;
                t = t.parent as IRTerm | undefined;
            }
            // and only share among refs whose free vars resolve to the
            // SAME binder instances (same anchor): refs under sibling
            // duplicated binders have no common scope to bind in.
            return anchorOf( ref as IRTerm ) === myAnchor;
        });

        // console.log("sameLettedRefs", sameLettedRefs.length );

        if( sameLettedRefs.length <= 0 ) {
            console.warn(
                "how did you get here? 0 references found for letted term;\n" +
                "the compiler can easly recover this edge case, but something funny is going on with this contract.\n\n"+
                "!!! PLEASE OPEN AN ISSUE ON GITHUB (https://github.com/HarmonicLabs/plu-ts/issues) !!!\n"
            );
            continue;
        }


        // always inline letted vars
        if(
            letted.value instanceof IRVar
            || letted.value instanceof IRSelfCall
            || (
                letted.value instanceof IRNative
                && !isForcedNativeTag( letted.value.tag )
            )
        ) {
            // console.log("inlining letted (value is var) with value", prettyIRText( letted.value ) )
            if( process.env.PEBBLE_DBG_ALL ) console.error( "[pop]   -> var-inline" );
            for( const elem of sameLettedRefs )
            {
                // inline
                _modifyChildFromTo(
                    elem.parent,
                    elem,
                    elem.value
                );
            }
            continue;
        }

        let lca: IRTerm | undefined = minScope ?? sameLettedRefs[0];
        
        // const forceHoist = false && sameLettedRefs.some( letted => letted.meta.forceHoist === true );
    
        for( let j = 1; j < sameLettedRefs.length; j++ )
        {
            const prevLca: IRTerm = lca; 
            lca = lowestCommonAncestor( lca, sameLettedRefs[j], maxScope );
            if( !isIRTerm( lca ) )
            {
                lca = prevLca;
            };
        }

        if( wasSingleReferenceButRecursive )
        {
            // OPTIMIZATION:
            // TODO:
            // see the general case below
            const unbounded = getUnboundedVars( letted.value );
            if( unbounded.size === 0 ) {
                // if closed
                // handle as hoisted
                for( const ref of sameLettedRefs ) {
                    _modifyChildFromTo(
                        ref.parent,
                        ref,
                        new IRVar( ref.name )
                    );
                }
                term = new IRApp(
                    new IRFunc(
                        [ letted.name ],
                        term
                    ),
                    letted.value,
                ) 
                continue;
            }
            // else find highest common ancestor where all unbounded vars are defined

            // OPTIMIZATION:
            // TODO:
            // only hoist outside the highest, but fully defined, IRRecursive
            // and NOT the highest overall
            // otherwise we risk paying for introducing stuff we don't use
            let tmp: IRTerm = lca;
            // let lowestOutsideRecursive: IRTerm = lca;
            while( true )
            {
                const tmpParent = tmp.parent;
                if( !tmpParent ) break;
                // NEVER climb OUT of a `Case` branch (same guard as the
                // main climb below): dispatch branches are bare terms and
                // only the selected one evaluates — escaping the branch
                // makes this letted run in EVERY arm. This path skipped
                // the guard, so a single-ref redeemer-field extractor
                // inside a method's loop climbed past the method dispatch
                // and crashed FOREIGN arms (masterpiece BUG 23:
                // `unListData :: not a data list` in an untouched method).
                if(
                    tmpParent instanceof IRCase
                    && tmp !== tmpParent.constrTerm
                ) break;
                tmp = tmpParent as unknown as IRTerm;
                if( tmp instanceof IRDelayed ) {
                    lca = tmp;
                    // lowestOutsideRecursive = tmp;
                    continue;
                }
                if( tmp instanceof IRFunc || tmp instanceof IRRecursive ) {
                    if( tmp.params.some( p => unbounded.has( p ) ) ) {
                        // some parameter is defined here
                        // so we stop
                        break;
                    }
                    else lca = tmp;
                    // else lowestOutsideRecursive = tmp;
                }
            }
            // lca = lowestOutsideRecursive;
        }


        if( !isIRTerm( lca ) )
        {
            throw new Error(
                "letting nodes with hash " + irHashToHex( lettedHash ) + " from different trees"
            );
        }

        const realLca = lca;

        // If EVERY reference reaches the LCA by crossing INTO a `Case`
        // branch, and MORE THAN ONE distinct branch is involved, the letted
        // cannot be shared at the LCA at all: the LCA sits at/above the
        // dispatch, and the machine evaluates only the selected branch — a
        // shared binding there would run in EVERY arm. This is the same
        // miscompilation class as the climb-out guard below, but for refs
        // SPREAD ACROSS arms (e.g. two sibling mint methods whose redeemers
        // share a field extractor `headList(dropList(k, fields))`): the
        // branch-boundary stop below can never trigger because the climb
        // starts already outside the branches. Duplicate the binding per
        // branch instead — each branch gets its own copy at its root.
        {
            const topCrossingOf = ( node: IRTerm ): IRTerm | undefined => {
                let cur: IRTerm = node;
                let found: IRTerm | undefined = undefined;
                while( cur !== realLca )
                {
                    const p = cur.parent;
                    if( !p ) break;
                    if(
                        p instanceof IRCase
                        && cur !== p.constrTerm
                    ) found = cur;
                    cur = p as unknown as IRTerm;
                }
                return found;
            };
            const branchGroups = new Map<IRTerm, IRLetted[]>();
            let allRefsCrossBranches = true;
            for( const ref of sameLettedRefs )
            {
                const branch = topCrossingOf( ref );
                if( !branch ) { allRefsCrossBranches = false; break; }
                const arr = branchGroups.get( branch ) ?? [];
                arr.push( ref );
                branchGroups.set( branch, arr );
            }
            if(
                allRefsCrossBranches
                && branchGroups.size > 1
                // NON-CLOSED values need the per-branch duplication:
                // evaluating them outside their branch is the actual
                // miscompilation (field extractors crash on foreign arms).
                // CLOSED values (shared forced-native bindings, hoisted
                // constants) are safe to share above the dispatch — and
                // duplicating them breaks the binding of letted terms
                // nested in their values — EXCEPT expensive ones
                // (hash-grade work): sharing those above the dispatch
                // taxes every arm that never uses them, so they get
                // per-arm bindings like non-closed values.
                && (
                    getUnboundedVars( letted.value ).size > 0
                    || containsExpensiveWork( letted.value )
                )
            )
            {
                // RECURSIVE placement: the top-level branch groups can be
                // PURPOSE-dispatch arms while the references live in deeper
                // STATE/method arms. Binding at the outer branch root would
                // evaluate the value for EVERY inner arm (hash-identical
                // extractors exist across arms, e.g. `unIData(headList(
                // redeemerFields))` for two different methods' first int
                // field) — a foreign arm's redeemer then crashes the
                // extractor (masterpiece hatch: `headList :: empty list`).
                // Descend through nested crossings until the group's refs
                // no longer all cross a deeper branch, and bind there.
                const isPartialValue = !isSafeToEagerlyEvaluate( letted.value );
                const work: { root: IRTerm, refs: IRLetted[] }[] =
                    [ ...branchGroups ].map( ([ branch, refs ]) => ({ root: branch, refs }) );
                while( work.length > 0 )
                {
                    const { root, refs } = work.pop()!;
                    // regroup THIS group's refs by their topmost crossing
                    // strictly BELOW `root`
                    const subGroups = new Map<IRTerm, IRLetted[]>();
                    let allCross = true;
                    for( const ref of refs )
                    {
                        let cur: IRTerm = ref as IRTerm;
                        let found: IRTerm | undefined = undefined;
                        while( cur !== root )
                        {
                            const p = cur.parent;
                            if( !p ) break;
                            if( p instanceof IRCase && cur !== ( p as IRCase ).constrTerm )
                                found = cur;
                            cur = p as unknown as IRTerm;
                        }
                        if( !found ) { allCross = false; break; }
                        const arr = subGroups.get( found ) ?? [];
                        arr.push( ref );
                        subGroups.set( found, arr );
                    }
                    if( allCross && subGroups.size > 0 )
                    {
                        // descend one level per group
                        for( const [ subBranch, subRefs ] of subGroups )
                            work.push({ root: subBranch, refs: subRefs });
                        continue;
                    }
                    // bind here: some ref is reached from `root` without
                    // crossing a deeper branch. For PARTIAL values still
                    // require a full spine witness (lambdas/delays also
                    // defer) — else keep per-site semantics.
                    if( isPartialValue && !hasSpineWitness( root, refs ) )
                    {
                        inlinePerRef( refs );
                        continue;
                    }
                    const rootParent = root.parent;
                    if( !rootParent ) { inlinePerRef( refs ); continue; }
                    const newNode = new IRApp(
                        new IRFunc(
                            [ letted.name ],
                            root
                        ),
                        letted.value.clone(),
                        { __src__ : letted.meta.__src__ }
                    );
                    _modifyChildFromTo(
                        rootParent,
                        root,
                        newNode
                    );
                    for( const ref of refs )
                    {
                        _modifyChildFromTo(
                            ref.parent,
                            ref,
                            new IRVar( ref.name )
                        );
                    }
                }
                continue;
            }
        }

        // point to the first func or delay node above the lca
        // (worst case scenario we hit the maxScope; which is an IRFunc)
        // IRFuncs should always be under IRRecursives if any
        //
        // NEVER climb OUT of a `Case` branch: int-scrutinee dispatch
        // branches are bare terms (neither IRFunc nor IRDelayed), and the
        // machine evaluates ONLY the selected branch — hoisting a letted
        // above the Case makes it run in EVERY arm. For per-arm redeemer
        // field extractors that is a real MISCOMPILATION: one method's
        // `headList(dropList(k, fields))` runs against another method's
        // shorter redeemer and crashes on-chain (`force headList []`).
        // instead we stop at the branch root and wrap the branch itself.
        //
        // floatable (total, hash-grade) values additionally climb PAST
        // lambda binders whose parameters they don't reference — hoisting
        // closure-invariant and loop-invariant work out of per-call bodies.
        // delays and case-branch edges still stop the climb.
        let caseBranchOwner: IRCase | undefined = undefined;
        {
            const floatUnbounded = canFloatOutOfLambda
                ? getUnboundedVars( letted.value )
                : undefined;
            let chosen: IRTerm | undefined = undefined;
            let cur: IRTerm | undefined = lca;
            while( cur )
            {
                if( cur instanceof IRFunc || cur instanceof IRDelayed )
                {
                    chosen = cur;
                    if( !canFloatOutOfLambda ) break;
                    if( cur instanceof IRDelayed ) break; // never cross delays
                    if( cur === maxScope ) break;
                    if( cur.params.some( p => floatUnbounded!.has( p ) ) ) break;
                    // keep climbing past this lambda
                }
                const curParent: IRParentTerm | undefined = cur.parent;
                if(
                    curParent instanceof IRCase
                    && cur !== curParent.constrTerm
                )
                {
                    if( chosen === undefined ) caseBranchOwner = curParent;
                    break;
                }
                cur = ( curParent as IRTerm | undefined ) ?? undefined;
            }
            if( chosen !== undefined ) lca = chosen;
            else if( caseBranchOwner !== undefined ) lca = cur; // the branch root
            else lca = undefined; // climbed past the root -> hoist path below
        }

        if( caseBranchOwner !== undefined && isIRTerm( lca ) )
        {
            // place AT the branch root: `branch` becomes
            // `[(λ name . branch) value]` — evaluated only when the branch
            // is actually selected
            const branchTerm = lca;
            if( !isSafeToEagerlyEvaluate( letted.value ) && !hasSpineWitness( branchTerm, sameLettedRefs ) )
            {
                inlinePerRef( sameLettedRefs );
                continue;
            }
            const lettedValue = letted.value.clone();
            const newNode = new IRApp(
                new IRFunc(
                    [ letted.name ],
                    branchTerm
                ),
                lettedValue,
                { __src__ : letted.meta.__src__ }
            );
            _modifyChildFromTo(
                caseBranchOwner,
                branchTerm,
                newNode
            );

            for( const ref of sameLettedRefs )
            {
                _modifyChildFromTo(
                    ref.parent,
                    ref,
                    new IRVar( ref.name )
                );
            }
            continue;
        }

        if( !isIRTerm( lca ) )
        {
            if( !lettedTermCanBeHoisted )
            throw new Error(
                "lowest common ancestor outside the max scope"
            );

            lca = realLca;
            const tmpRoot = handleLettedAsHoistedAndReturnRoot(
                letted,
                realLca, // lca
                sameLettedRefs,
                term
            );

            if( lca === maxScope || !lca.parent ) term = tmpRoot;
            
            continue;
        }

        // the climb above only exits normally on an IRFunc / IRDelayed
        // (the case-branch break path `continue`d already)
        const parentNode = lca as IRFunc | IRRecursive | IRDelayed;
        const parentNodeDirectChild = (
            parentNode instanceof IRFunc ||
            parentNode instanceof IRRecursive
        ) ? parentNode.body : parentNode.delayed;

        if( !isSafeToEagerlyEvaluate( letted.value ) && !hasSpineWitness( parentNodeDirectChild, sameLettedRefs ) )
        {
            // binding here would evaluate the value whenever this scope
            // runs, but every use site is behind a conditional/deferred
            // edge: keep per-site semantics
            inlinePerRef( sameLettedRefs );
            continue;
        }

        // now we replace
        const lettedValue = letted.value.clone();

        const newNode = new IRApp(
            new IRFunc(
                [ letted.name ],
                parentNodeDirectChild
            ),
            lettedValue,
            { __src__ : letted.meta.__src__ }
        );

        // replace child with new node
        if( parentNode instanceof IRFunc || parentNode instanceof IRRecursive ) parentNode.body = newNode;
        else parentNode.delayed = newNode;

        for( const ref of sameLettedRefs )
        {
            _modifyChildFromTo(
                ref.parent,
                ref,
                new IRVar( ref.name )
            );
        }

        // const delayed = parentNode instanceof IRDelayed;
        // let finalMaxScope: IRFunc | IRDelayed = parentNode;
        // while(!(
        //     finalMaxScope instanceof IRFunc ||
        //     finalMaxScope instanceof IRDelayed
        // ))
        // {
        //     finalMaxScope = (finalMaxScope as any).parent as any
        // }
        // // // console.log("final max scope (delayed: " + delayed + ")" , prettyIRText( finalMaxScope ) )
    }
}





/**
 * `true` when EVERY reference already sits inside the scope of an existing
 * binder of `sym` (an earlier compile round bound this same letted value —
 * same hash, same symbol — somewhere above). Reusing the ancestor binding
 * is sound (every IR pass is semantics-preserving) and avoids NESTING a
 * second binder of the same symbol: nested same-symbol binders capture
 * each other's references, and cloned values can DIVERGE under later
 * per-instance rewrites (the BUG 23/25 family). Binder symbols must stay
 * hash-derived and shared — IR hashing is symbol-identity-based, so
 * per-site fresh symbols would break hash-dedup of equivalent terms.
 */
function allRefsUnderBinderOf( refs: IRLetted[], sym: symbol ): boolean
{
    return refs.length > 0 && refs.every( ref => {
        let t: IRTerm | undefined = ref as IRTerm;
        while( t )
        {
            const p = t.parent as IRTerm | undefined;
            if(
                p instanceof IRFunc
                && p.params.includes( sym )
            ) return true;
            t = p;
        }
        return false;
    });
}

/**
 * SPINE WITNESS: `true` if at least one reference is reached from `from`
 * without crossing any deferring/conditional edge — i.e. whenever `from`
 * is evaluated, that reference (and hence the letted value) is evaluated
 * too. Placing a binding at `from` is then evaluation-order-neutral.
 *
 * Deferring/conditional edges: entering a `Case` BRANCH (only the selected
 * one runs), entering an `IRFunc`/`IRRecursive` BODY (runs only when
 * applied — possibly zero times), entering an `IRDelayed` (runs only when
 * forced).
 *
 * Used for `meta.siteScoped` letted values (decode-once field extractors):
 * their source semantics are per-use-site, so a PARTIAL (can-fail) value
 * must never be evaluated on a path where no use site would have run it.
 */
function hasSpineWitness( from: IRTerm, refs: IRLetted[] ): boolean
{
    return refs.some( ref => {
        let cur: IRTerm = ref as IRTerm;
        while( cur !== from )
        {
            const p = cur.parent as IRTerm | undefined;
            if( !p ) return false; // `from` not an ancestor: no witness
            if( p instanceof IRCase && cur !== ( p as IRCase ).constrTerm ) return false;
            if( ( p instanceof IRFunc || p instanceof IRRecursive ) && cur === ( p as any ).body ) return false;
            if( p instanceof IRDelayed ) return false;
            cur = p;
        }
        return true;
    });
}

/** replace every reference with its own copy of the value (per-site
 *  semantics: exactly what the source expressed before sharing) */
function inlinePerRef( refs: IRLetted[] ): void
{
    for( const ref of refs )
    {
        _modifyChildFromTo(
            ref.parent,
            ref,
            ref.value
        );
    }
}


/**
 * `true` if `ref` sits inside the scope of an existing binder of `sym`.
 * Used ONLY on the single-reference path: an instance of an
 * already-placed letted can surface in a later scan (it was nested inside
 * ANOTHER letted's value when the group was bound, and got attached with
 * that value's clone). Inlining it would re-evaluate the shared value —
 * measured as whole extra sha256 chains in the masterpiece benchmark
 * (BUG 16 "case 2"). Since a binder of the same symbol binds the same
 * (hash-identical) value, pointing the reference at it is sound and free.
 */
function refUnderBinderOf( ref: IRTerm, sym: symbol ): boolean
{
    let t: IRTerm | undefined = ref;
    while( t )
    {
        const p = t.parent as IRTerm | undefined;
        if( p instanceof IRFunc && p.params.includes( sym ) ) return true;
        t = p;
    }
    return false;
}

function handleLettedAsHoistedAndReturnRoot(
    letted: IRLetted,
    lca: IRTerm,
    sameLettedRefs: IRLetted[],
    currentRoot: IRTerm
): IRTerm
{
    const lettedHash = letted.hash;
    let parentNode: IRParentTerm | undefined = lca.parent;
    const parentNodeDirectChild = lca;

    // now we replace
    const lettedValue = letted.value; //.clone();

    // no need to modify letted value dbns, since closed
    // modifyValueToLetDbns( lettedValue, getDiffDbn( letted, parentNode ) );

    const newNode = new IRApp(
        new IRFunc(
            [ letted.name ],
            parentNodeDirectChild
        ),
        lettedValue,
        { __src__ : letted.meta.__src__ }
    );

    // replace child with new node
    if( parentNode )
    {
        _modifyChildFromTo(
            parentNode,
            parentNodeDirectChild,
            newNode
        );
    }
    else
    {
        currentRoot = newNode;
    }

    for( const ref of sameLettedRefs )
    {
        _modifyChildFromTo(
            ref.parent,
            ref,
            new IRVar( ref.name )
        );
    }

    return currentRoot;
}

function someParentIsRecursive( term: IRTerm ): boolean
{
    let parent: IRParentTerm;;
    while( parent = term.parent! ) {
        if( parent instanceof IRRecursive ) return true;
        term = parent;
    }
    return false;
}