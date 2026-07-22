
/**
 * assumes BOTH arrays are sorted in ascending order
 * 
 * @returns {string[]} reference to the **same** target array.
 */
export function mergeSortedStrArrInplace( target: string[], source: string[] ): string[]
{
    if( source.length === 0 ) return target;
    if( target.length === 0 ) {
        target.push( ...source ); 
        return target;
    }

    source = source.slice(); // copy to avoid modifying the original array

    let start: number = 0;
    let elem: string;
    while( elem = source.shift()! ) start = insertUniqueSortedInpalce( target, elem, start ) + 1;

    return target;
}

/**
 * 
 * @returns the position where the element was inserted (or where it was already present)
 */
function insertUniqueSortedInpalce( target: string[], elem: string, start: number = 0, end: number = target.length ): number
{
    if( start >= end ) {
        target.splice( end, 0, elem );
        return end;
    }

    let mid: number;
    while( start < end )
    {
        mid = (start + end) >> 1;

        if( target[mid] === elem ) return mid; // already exists, do nothing
        
        if( target[mid] < elem )
        {
            start = mid + 1;
            if( target[start] > elem )
            {
                target.splice( start, 0, elem );
                return start;
            }
        }
        else if( target[mid] > elem ) end = mid;
    }

    // binary search exhausted: the element belongs exactly at `start`
    // (which may be `target.length`, i.e. an append)
    target.splice( start, 0, elem );
    return start;
}