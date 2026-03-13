/**
 * only keeps elements from target that exist in source array.
 * Assumes BOTH arrays are sorted in ascending order.
 * 
 * @returns {string[]} reference to the **same** target array.
 */
export function keepSortedStrArrInplace( target: string[], source: string[] ): string[]
{
    if( source.length === 0 ) {
        target.length = 0; // clear target if source is empty
        return target;
    }
    if( target.length === 0 ) return target; // nothing to keep if target is empty

    source = source.slice(); // copy to avoid modifying the original array

    let fstSrc = source.shift()!; // get first element from source
    for( let i = 0; i < target.length; i++ )
    {
        const elem = target[i];
        if( elem === fstSrc ) {
            fstSrc = source.shift()!; // get next element from source
            if( !fstSrc ) {
                target.length = i + 1; // truncate target to current index
                return target; // no more elements to keep
            }
            continue; // element is in source, check next without removing this
        }

        // elem > fstSrc: source has elements not in target, advance source
        if( elem > fstSrc )
        {
            while( source.length > 0 && fstSrc < elem ) {
                fstSrc = source.shift()!;
            }
            if( fstSrc === elem ) {
                fstSrc = source.shift()!;
                if( !fstSrc ) {
                    target.length = i + 1;
                    return target;
                }
                continue;
            }
            // fstSrc > elem or source exhausted: elem not in source, fall through to remove
        }

        // not equal, remove the element
        target.splice(i, 1);
        i--; // adjust index since we removed an element
    }

    return target; // return the modified target array
}

/**
 * Binary search to find the exact index of an element
 * @returns the index of the element if found, -1 otherwise
 */
function findElementIndex(
    target: string[],
    elem: string,
    start: number = 0,
    end: number = target.length
): number
{
    if (start >= end) return -1;

    let mid: number;
    while (start < end) {
        mid = (start + end) >> 1;

        if (target[mid] === elem) return mid; // found exact match
        
        if( target[mid] < elem ) start = mid + 1;
        else end = mid;
    }

    return -1; // not found
}