import { MutArrayLike } from "../../utils/MutArrayLike";

export function makeArrayLikeProxy<T>(
    arr: ArrayLike<T>,
    isValidElem: ( elem: T ) => boolean,
    initModifyElem: ( elem: T ) => T,
    modifyElem: ( elem: T, oldElem: T ) => T
): MutArrayLike<T>
{
    const like = {} as MutArrayLike<T>;

    Object.defineProperty(
        like, "length", {
            value: arr.length,
            writable: false,
            enumerable: false,
            configurable: false
        }
    );

    const clonedArr = Array.from( arr );

    for( let i = 0; i < arr.length; i++ )
    {
        clonedArr[i] = initModifyElem( arr[i] );
        Object.defineProperty(
            like, i, {
                get: () => clonedArr[i],
                set: ( newElem: T ) => {
                    if( isValidElem( newElem ) )
                        clonedArr[i] = modifyElem( newElem, clonedArr[i] );
                    
                    return newElem;
                },
                enumerable: true,
                configurable: false
            }
        );
    }

    Object.defineProperty(
        like, Symbol.iterator, {
            // iterate the BACKING array directly: the per-index getters
            // above cost a property-descriptor call per element, and
            // `children()`/`Array.from` over these proxies is one of the
            // hottest paths of the whole backend (measured ~9% of a
            // real-validator export). Reads are identical — writes still
            // go through the setters.
            value: function* iterArrayLikeProxy() { yield* clonedArr; },
            writable: false,
            enumerable: false,
            configurable: false
        }
    );

    return like;
}
