import { IRApp } from "../../IRNodes/IRApp";
import { IRDelayed } from "../../IRNodes/IRDelayed";
import { IRForced } from "../../IRNodes/IRForced";
import { IRFunc } from "../../IRNodes/IRFunc";
import { IRHoisted } from "../../IRNodes/IRHoisted";
import { IRLetted } from "../../IRNodes/IRLetted";
import { IRTerm } from "../../IRTerm";
import { IRParentTerm } from "../../utils/isIRParentTerm";
import { IRConstr } from "../../IRNodes/IRConstr";
import { IRCase } from "../../IRNodes/IRCase";
import { equalIrHash, IRHash, irHashToHex, isIRHash } from "../../IRHash";
import { IRRecursive } from "../../IRNodes/IRRecursive";
import { isIRTerm } from "../../utils/isIRTerm";
import { inheritRange } from "../../sourceMap/irRanges";
import { noteVarReplaced } from "../../sourceMap/irDebug";

/**
 *
 * @param parent node to modify the child of
 * @param currentChild mainly passed to distinguish in case of `IRApp`
 * @param newChild new node's child
 */
export function _modifyChildFromTo(
    parent: IRParentTerm | undefined,
    currentChild: IRTerm | IRHash,
    newChild: IRTerm
): void
{
    const replaced = isIRTerm( currentChild ) ? currentChild : (
        parent?.children().find( child => equalIrHash( child.hash, currentChild ) )
    );
    _replaceChild( parent, currentChild, newChild );
    inheritRange( newChild, replaced );
    noteVarReplaced( newChild, replaced );
}

function _replaceChild(
    parent: IRParentTerm | undefined,
    currentChild: IRTerm | IRHash,
    newChild: IRTerm
): void
{
    if( parent === undefined )
    {
        throw new Error(
            "'_modifyChildFromTo' received an undefined parent, possibly root"
        );
    }
    if(
        // currentChild has parent property
        isIRTerm( currentChild ) &&
        // and is not (already) undefined
        currentChild.parent !== undefined &&
        // and the `parent` passed to the function is the parent of the `currentChild`
        currentChild.parent === parent &&
        // and child to be modified is not the same object
        currentChild !== newChild
    )
    {
        // we are modifying the child
        // so we remove parent the reference
        currentChild.parent = undefined;
    }

    // DO NOT USE **ONLY** SHALLOW EQUALITY
    // child might be cloned
    // however delay hash computation until needed
    let _childHash: IRHash | undefined;
    const currChildHash = () => {
        if( isIRHash( _childHash ) ) return _childHash
        _childHash = isIRHash( currentChild ) ? currentChild : currentChild.hash
        return _childHash;
    };

    if( parent instanceof IRApp )
    {
        // check the argument first as it is more likely to have a smaller tree
        if( currentChild === parent.arg )
        {
            parent.arg = newChild;
        }
        else if( currentChild === parent.fn )
        {
            parent.fn = newChild;
        }
        else if( equalIrHash( parent.arg.hash, currChildHash() ) )
        {
            parent.arg = newChild;
        }
        else if( equalIrHash( parent.fn.hash, currChildHash() ) )
        {
            parent.fn = newChild;
        }
        else
        {
            throw new Error(
                "unknown 'IRApp' child to modify; given child to modify hash: " +
                irHashToHex( currChildHash() ) +
                "; function child hash: " + irHashToHex( parent.fn.hash ) +
                "; argument child hash: " + irHashToHex( parent.arg.hash )
            );
        }

        return;
    }
    else if( parent instanceof IRConstr )
    {
        let foundChild = false;
        for( let i = 0; i < parent.fields.length; i++ )
        {
            const field = parent.fields[i];
            if( field === currentChild )
            {
                parent.fields[i] = newChild;
                foundChild = true;
                break
            }
        }
        if( foundChild ) return;
        for( let i = 0; i < parent.fields.length; i++ )
        {
            const field = parent.fields[i];
            if( equalIrHash( field.hash, currChildHash() ) )
            {
                parent.fields[i] = newChild;
                break
            }
        }
        return;
    }
    else if( parent instanceof IRCase )
    {
        if( parent.constrTerm === currentChild )
        {
            parent.constrTerm = newChild;
            return;
        }
        let foundChild = false;
        for( let i = 0; i < parent.continuations.length; i++ )
        {
            const field = parent.continuations[i];
            if( field === currentChild )
            {
                parent.continuations[i] = newChild;
                foundChild = true;
                break
            }
        }
        if( foundChild ) return;
        if( equalIrHash( currChildHash(), parent.constrTerm.hash ) )
        {
            parent.constrTerm = newChild;
            return;
        }
        for( let i = 0; i < parent.continuations.length; i++ )
        {
            const field = parent.continuations[i];
            if( equalIrHash( field.hash, currChildHash() ) )
            {
                parent.continuations[i] = newChild;
                break
            }
        }
        return;
    }

    if( parent instanceof IRDelayed )
    {
        parent.delayed = newChild;
        return;
    }

    if( parent instanceof IRForced )
    {
        parent.forced = newChild;
        return;
    }

    if( parent instanceof IRFunc )
    {
        parent.body = newChild;
        return;
    }

    if( parent instanceof IRRecursive )
    {
        parent.body = newChild;
        return;
    }

    if( parent instanceof IRHoisted )
    {
        parent.hoisted = newChild;
        return;
    }

    if( parent instanceof IRLetted )
    {
        parent.value = newChild;
        return;
    }

    const tsEnsureExhaustiveCheck: never = parent;
    throw new Error(
        "unknown parent type in '_modifyChildFromTo': " +
        (parent as any).constructor?.name
    );
}