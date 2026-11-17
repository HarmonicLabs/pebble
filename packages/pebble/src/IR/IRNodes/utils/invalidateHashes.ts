/**
 * A term's hash is a function of what the term holds, and each node remembers its own once
 * computed. So when a child of a node is replaced, the hash that node remembers — and the one
 * every term the node is in remembers — is the hash of a term that no longer exists, and must
 * be forgotten: `handleLetted` and `handleHoisted` bind two terms ONCE when their hashes are
 * equal, and read "equal hashes" as "the same term, with the same variables".
 *
 * Every setter of a child calls this on the node it changes (and so does whoever edits the
 * parameters of a function in place).
 *
 * The walk stops at the first node that remembers no hash: hashing a term hashes everything
 * it holds, so a node that remembers nothing is in no term that does.
 */
export function invalidateHashesFrom( node: object | undefined ): void
{
    let n: any = node;
    while( n !== undefined && n._hash !== undefined )
    {
        n._hash = undefined;
        n = n._parent;
    }
}
