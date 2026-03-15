import { IRHash, irHashToHex } from "../../IRHash";
import { IRFunc } from "../../IRNodes";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRRecursive } from "../../IRNodes/IRRecursive";
import { IRTerm } from "../../IRTerm";
import { getChildren } from "../../tree_utils/getChildren";
import { _modifyChildFromTo } from "../_internal/_modifyChildFromTo";
import { findAll } from "../_internal/findAll";
import { sanifyTree } from "./sanifyTree";

const _hoisted_cache = new Map<IRHash, WeakRef<IRLetted>>();

export function __unsafe_clear_hoisted_cache(): void
{
    _hoisted_cache.clear();
}

export function replaceHoistedWithLetted( term: IRTerm ): void
{
    // children first
    const children = term.children();
    for( const c of children ) replaceHoistedWithLetted( c );
    
    // then check if hoisted
    if(!( term instanceof IRHoisted )) return;
    
    const parent = term.parent!;
    if( !parent ) throw new Error("hoisted node has no parent");

    const cached = _hoisted_cache.get( term.hash )?.deref();
    const letted = (
        cached ??
        new IRLetted(
            term.name,
            term.hoisted,
            { isClosed: true }
        )
    ).clone();
    if( !cached ) _hoisted_cache.set( term.hash, new WeakRef( letted ) );

    // replace hoisted with letted
    _modifyChildFromTo( parent, term, letted );
}