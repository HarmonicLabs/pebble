import { testOptions, COMPILER_VERSION } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { parseUPLC, getNRequiredForces, Builtin, Force, Delay, Lambda, Application, Case, Constr, UPLCVar } from "@harmoniclabs/uplc";

// Bug 11 from `the-cardano-masterpiece` (PEBBLE_BUGS.md, against 0.3.6):
// in contracts with enough shared bodies, handling letted/hoisted terms
// re-materializes custom (negative-tag) IRNatives from cached/cloned values
// AFTER the `replaceNativesAndReturnRoot` sweeps, and they crash the forcing
// pass with "getNRequiredForces ... input was: -<tag>".
// The `compileIRToUPLC` drain loop now re-runs the native lowering until
// natives, letted and hoisted are ALL gone.
//
// No minimal repro is known (isolated constructs compile fine — it needs the
// full contract's sharing level), so this embeds the actual
// `masterpiece.pebble` (3 states + mint + LinearMap metadata + dag-pb CID
// machinery) that triggered it. Snapshot of the sources as of 2026-07-22.

const MASTERPIECE = `// ===========================================================================
//  Masterpiece — the on-chain collaborative 1024x1024 image/bmp
// ===========================================================================
//
//  The image is a top-down 8-bit BMP: a constant header+palette (the
//  \`bmpHeader\` param, ~1078 bytes) followed by 1024 rows of 1024 one-byte
//  pixels. Pixel rows are stored on-chain in 128 leaf UTxOs of 8 rows
//  (8192 bytes) each: leaf i holds rows [8i, 8i+8).
//
//  The whole file is addressed on IPFS as one flat dag-pb (UnixFS) node
//  linking 129 raw-leaf chunks: [ header, chunk 0 .. chunk 127 ]. The root
//  UTxO tracks the 128 chunk CIDs and, on every commit, recomputes the
//  whole-file CID on-chain — so the \`image\` URI in its CIP-68 metadata is
//  *provably* the CID of the (last committed) canvas.
//
//  Tokens (all under this contract's policy, minted once in \`init\`):
//    * (100)masterpiece — CIP-68 reference NFT, locked here forever with the
//      RootNft datum (Constr 0 [metadata, version, extra] as CIP-68 demands;
//      RootNft is deliberately the FIRST state declared).
//    * (222)masterpiece — CIP-68 user token, freely tradeable; wallets
//      holding it display the live canvas via the (100) datum.
//    * 128 unnamed leaf tokens — internal state markers, one per leaf UTxO.
//
//  Editing is DECOUPLED from the root so leaf edits parallelize freely:
//    * \`LeafNode.edit\` spends ONE leaf (one per tx — an 8KB chunk output
//      barely fits the tx size limit) and never touches the root. Changed
//      bytes must be covered by Ownership NFTs (policy =
//      \`ownershipContractHash\`) present in REFERENCE inputs whose holding
//      addresses SIGNED the tx — pub-key holders only, script-held
//      ownership cannot edit. Different leaves = different UTxOs, so edits
//      to different leaves land in the same block without contention.
//    * \`RootNft.commit\` spends ONLY the root, REFERENCES any set of leaf
//      UTxOs (redeemer indices sorted by ascending leaf index), and syncs
//      their current CIDs into \`leafsCids\`, recomputing the whole-image CID
//      and the CIP-68 \`image\` URI. Permissionless: the committer proves
//      nothing — referenced leaf state is already validator-maintained
//      truth. The root is thus an eventually-consistent snapshot: entries
//      lag behind leaf edits until the next commit.

import { cidV1Raw, cidToIpfsUri, wholeImageCid } from "./lib/ipfs.pebble";
import { Coordinates, rectName } from "./lib/rect.pebble";

const N_LEAFS = 128;
const LINE_LENGTH = 1024;
const CHUNK_SIZE = LINE_LENGTH * 8; // 8192 bytes, 8 rows per leaf

const LEAF_NFT_NAME = #; // empty name; internal marker, not CIP-68

// CIP-67 labeled names, body "masterpiece"
const ROOT_REF_NFT_NAME  = #000643b06d61737465727069656365; // (100)masterpiece
const ROOT_USER_NFT_NAME = #000de1406d61737465727069656365; // (222)masterpiece

// CIP-68 metadata: exactly these three keys, checked on every root update
const METADATA_NAME_KEY       = #6e616d65;           // "name"
const METADATA_IMAGE_KEY      = #696d616765;         // "image"
const METADATA_MEDIA_TYPE_KEY = #6d6564696154797065; // "mediaType"
const ROOT_DISPLAY_NAME = #5468652043617264616e6f204d61737465727069656365; // "The Cardano Masterpiece"
const MEDIA_TYPE_BMP    = #696d6167652f626d70;       // "image/bmp"

// mutable state beyond the CIP-68 metadata, kept under the \`extra\` field
struct RootState {
    leafsCids: List<bytes>, // 128 CIDs of the leaf chunks, in leaf order
    rawCid: bytes           // 36-byte CIDv1 of the whole-image dag-pb root
}

// whole-image CID over [ header, leaf chunks... ] as one flat dag-pb node.
// raw-leaf Tsize == blocksize, so one sizes list serves both roles.
function wholeImageCidOf( header: bytes, leafsCids: List<bytes> ): bytes {
    const headerLen = header.length();
    let sizes: List<int> = [];
    for( let i = 0; i < N_LEAFS; i++ ) {
        sizes = sizes.prepend( CHUNK_SIZE );
    }
    sizes = sizes.prepend( headerLen );
    return wholeImageCid(
        leafsCids.prepend( cidV1Raw( header ) ),
        sizes,
        headerLen + N_LEAFS * CHUNK_SIZE,
        sizes
    );
}

contract Masterpiece {

    param ownershipContractHash: bytes;
    param genesisUtxo: TxOutRef;
    param bmpHeader: bytes; // BMP header + 256-color palette (~1078 bytes),
                            // immutable, top-down rows (negative biHeight)

    // one-shot genesis: mint the two root tokens + 128 leaf markers. The
    // leaf UTxOs themselves CANNOT be created here — 128 x 8KB datums is
    // ~1MB, far past the 16KB tx limit — so all 128 markers land in a single
    // Nursery UTxO and leaves are hatched one per tx afterwards (see
    // Nursery.hatch below).
    mint init(
        genesisUtxoIdx: int
    ) {
        const { tx, policy } = context;

        assert tx.inputs[genesisUtxoIdx].ref == this.genesisUtxo;

        // exact mint (order-independent equality via two-sided contains)
        const expectedMint = tx.mint.scale( 0 )
            .insert( policy, LEAF_NFT_NAME, N_LEAFS )
            .insert( policy, ROOT_REF_NFT_NAME, 1 )
            .insert( policy, ROOT_USER_NFT_NAME, 1 );
        assert tx.mint.contains( expectedMint ) && expectedMint.contains( tx.mint );

        const ownAddr = Address.Address{
            payment: Credential.Script{ hash: policy },
            stake: undefined
        };

        const initialChunk = std.builtins.replicateByte( CHUNK_SIZE, 255 );
        const initialCid = cidV1Raw( initialChunk );

        // all 128 leaf markers in one Nursery node, ready to hatch leaf 0
        const Some{ value: nurseryOut } =
            tx.outputs.find( o => o.value.amountOf( policy, LEAF_NFT_NAME ) == N_LEAFS );
        assert nurseryOut.address == ownAddr;
        const InlineDatum{ datum: nd } = nurseryOut.datum;
        const Nursery{ nextIdx: nx } = nd as Masterpiece;
        assert nx == 0;

        // the CIP-68 reference NFT with the root datum. Its leaf-CID list
        // starts as 128 copies of the initial (all-white) chunk CID — exactly
        // what every leaf will hold when hatched.
        const Some{ value: rootOut } =
            tx.outputs.find( o => o.value.amountOf( policy, ROOT_REF_NFT_NAME ) == 1 );
        assert rootOut.address == ownAddr;

        const InlineDatum{ datum: rd } = rootOut.datum;
        const RootNft{ metadata: md, version: ver, extra: ext } = rd as Masterpiece;

        assert ext.leafsCids.length() == N_LEAFS;
        assert ext.leafsCids.every( c => c == initialCid );

        const rootCid = wholeImageCidOf( this.bmpHeader, ext.leafsCids );
        assert ext.rawCid == rootCid;

        assert ver == 1;
        assert md.length() == 3;
        assert md.lookup( METADATA_NAME_KEY )! == ROOT_DISPLAY_NAME;
        assert md.lookup( METADATA_IMAGE_KEY )! == cidToIpfsUri( rootCid );
        assert md.lookup( METADATA_MEDIA_TYPE_KEY )! == MEDIA_TYPE_BMP;

        // the (222) user token goes wherever the deployer likes
    }

    // CIP-68 reference-NFT state. MUST stay the first state declared:
    // readers resolve the (100) token's datum as Constr 0 [metadata, version, extra]
    state RootNft {
        metadata: LinearMap<bytes, bytes>;
        version: int;
        extra: RootState;

        // sync the referenced leaves' CIDs into the list, recompute the
        // whole-image CID, and pin the CIP-68 metadata. Leaves are READ via
        // reference inputs, never spent here. \`commitRefIdxs\`: indices into
        // tx.refInputs, ordered by ASCENDING leaf index.
        spend commit(
            commitRefIdxs: List<int>
        ) {
            const { tx, spendingRef, state: { metadata, extra } } = context;

            const Some{ value: ownInput } = tx.inputs.find( i => i.ref == spendingRef );
            const ownAddr = ownInput.resolved.address;
            const ownPolicy = ownAddr.payment.hash();

            // genuine root: carries the (100) reference NFT
            assert ownInput.resolved.value.amountOf( ownPolicy, ROOT_REF_NFT_NAME ) == 1;

            // continuing root output
            const rootOuts = tx.outputs.filter( o =>
                o.address == ownAddr
                && o.value.amountOf( ownPolicy, ROOT_REF_NFT_NAME ) == 1
            );
            assert rootOuts.length() == 1;
            const InlineDatum{ datum: rod } = rootOuts[0].datum;
            const RootNft{ metadata: newMd, version: newVer, extra: newExt } =
                rod as Masterpiece;

            // decode each committed leaf reference once: must be a genuine
            // leaf UTxO (marker token at this address); its datum is
            // validator-maintained truth, nothing further to prove. We build
            // the (idx, cid) lists by reverse-prepend so their heads come
            // out ascending, enabling the linear merge-join below (a
            // per-position scan is quadratic and blows the CPU budget on a
            // full 128-leaf commit). A -1/# sentinel keeps heads total.
            let refLeafIdxs: List<int> = [ -1 ];
            let refLeafCids: List<bytes> = [ # ];
            const nRefs = commitRefIdxs.length();
            for( let n = nRefs - 1; n >= 0; n-- ) {
                const ri = tx.refInputs[ commitRefIdxs[n] ];
                assert ri.resolved.address == ownAddr;
                assert ri.resolved.value.amountOf( ownPolicy, LEAF_NFT_NAME ) == 1;
                const InlineDatum{ datum: rld } = ri.resolved.datum;
                const LeafNode{ idx: lidx, rawCid: lcid, chunk: lch } =
                    rld as Masterpiece;
                refLeafIdxs = refLeafIdxs.prepend( lidx );
                refLeafCids = refLeafCids.prepend( lcid );
            }

            // leaf CID list, one linear pass: committed entries take the
            // referenced leaf's current CID, everything else byte-identical
            // to the old list. Sentinel idx -1 never equals j, so exhausted
            // ref lists simply stop matching (heads stay safe).
            assert newExt.leafsCids.length() == N_LEAFS;
            let oldCids = extra.leafsCids;
            let newCids = newExt.leafsCids;
            let rIdxs = refLeafIdxs;
            let rCids = refLeafCids;
            for( let j = 0; j < N_LEAFS; j++ ) {
                const oldC = oldCids.head();
                const newC = newCids.head();
                const hasRef = rIdxs.head() == j;
                const expectedC = hasRef ? rCids.head() : oldC;
                assert newC == expectedC;
                rIdxs = hasRef ? rIdxs.tail() : rIdxs;
                rCids = hasRef ? rCids.tail() : rCids;
                oldCids = oldCids.tail();
                newCids = newCids.tail();
            }
            // every committed ref must have been consumed — catches
            // mis-ordered or out-of-range redeemer entries loudly instead of
            // silently ignoring them
            assert rIdxs.head() == -1;

            const newRootCid = wholeImageCidOf( this.bmpHeader, newExt.leafsCids );
            assert newExt.rawCid == newRootCid;

            // CIP-68 metadata: same 3 keys in the fixed [name, image,
            // mediaType] order (pinned since init), image tracks the new
            // CID. Read positionally: LinearMap.lookup mis-lowers to UPLC
            // in 0.3.6 (PEBBLE_BUGS.md)
            assert newVer == 1;
            assert newMd.length() == 3;
            assert newMd.lookup( METADATA_NAME_KEY )! == metadata.lookup( METADATA_NAME_KEY )!;
            assert newMd.lookup( METADATA_MEDIA_TYPE_KEY )! == metadata.lookup( METADATA_MEDIA_TYPE_KEY )!;
            assert newMd.lookup( METADATA_IMAGE_KEY )! == cidToIpfsUri( newRootCid );
        }
    }

    // one 8192-byte chunk of pixel rows, marked by an unnamed leaf token
    state LeafNode {
        idx: int;      // 0..127
        rawCid: bytes; // cidV1Raw( chunk )
        chunk: bytes;  // 8192 bytes = rows [8*idx, 8*idx+8)

        // chunk integrity + pixel ownership of every changed byte.
        // \`ownerRects\`: the rects (sorted by x0) of the Ownership NFTs
        // covering the changed pixels. The validator FORMATS each rect into
        // its human-readable asset name — "masterpiece-x0-y0-x1-y1" — and
        // requires that NFT; formatting is injective, so the redeemer can
        // only name rects that were genuinely claimed.
        spend edit(
            ownerRects: List<Coordinates>
        ) {
            const { tx, spendingRef, state: { idx: li, chunk: oldChunk } } = context;

            const Some{ value: ownInput } = tx.inputs.find( i => i.ref == spendingRef );
            const ownAddr = ownInput.resolved.address;
            const ownPolicy = ownAddr.payment.hash();

            // genuine leaf: carries a leaf marker token
            assert ownInput.resolved.value.amountOf( ownPolicy, LEAF_NFT_NAME ) == 1;

            // continuing leaf output (unique: leaf markers never leave, so a
            // second spent leaf would surface as a second output here)
            const leafOuts = tx.outputs.filter( o =>
                o.address == ownAddr
                && o.value.amountOf( ownPolicy, LEAF_NFT_NAME ) == 1
            );
            assert leafOuts.length() == 1;
            const InlineDatum{ datum: lod } = leafOuts[0].datum;
            const LeafNode{ idx: newIdx, rawCid: newCid, chunk: newChunk } =
                lod as Masterpiece;

            assert newIdx == li;
            assert newChunk.length() == CHUNK_SIZE;
            assert newCid == cidV1Raw( newChunk );

            // ownership: every named NFT must sit in a reference input whose
            // holder signed this tx. Pub-key holders only — script-held
            // ownership NFTs cannot edit.
            const ownershipHash = this.ownershipContractHash;
            const nRects = ownerRects.length();
            for( let n = 0; n < nRects; n++ ) {
                const nm = rectName( ownerRects[n] );
                const Some{ value: refIn } = tx.refInputs.find( i =>
                    i.resolved.value.amountOf( ownershipHash, nm ) == 1
                );
                const PubKey{ hash: holderPkh } = refIn.resolved.address.payment;
                assert tx.requiredSigners.includes( holderPkh );
            }

            // every byte outside the owned rects must be unchanged. Walk each
            // of the 8 rows left to right; the rects covering the row (in x0
            // order — enforced by the cursor monotonicity) delimit the
            // must-be-equal gaps. Coords are half-open [x0,x1)x[y0,y1), rows
            // top-down (the BMP header declares negative height).
            for( let r = 0; r < 8; r++ ) {
                const y = li * 8 + r;
                const rowOff = r * LINE_LENGTH;
                let cursor = 0;
                for( let n = 0; n < nRects; n++ ) {
                    const rc = ownerRects[n];
                    // rects not covering this row contribute an empty gap
                    // and leave the cursor unmoved
                    const covers = rc.y0 <= y && y < rc.y1;
                    const gapEnd = covers ? rc.x0 : cursor;
                    assert cursor <= gapEnd;
                    assert std.bytes.slice( rowOff + cursor, gapEnd - cursor, oldChunk )
                        == std.bytes.slice( rowOff + cursor, gapEnd - cursor, newChunk );
                    cursor = covers ? rc.x1 : cursor;
                }
                assert std.bytes.slice( rowOff + cursor, LINE_LENGTH - cursor, oldChunk )
                    == std.bytes.slice( rowOff + cursor, LINE_LENGTH - cursor, newChunk );
            }
        }
    }

    // undistributed leaf markers, waiting to become leaf UTxOs. Genesis puts
    // all 128 here (the leaf datums are ~8KB each and cannot share one tx);
    // each hatch tx peels off exactly one leaf, in index order.
    state Nursery {
        nextIdx: int; // the leaf this nursery hatches next (0..127)

        spend hatch() {
            const { tx, spendingRef, state: { nextIdx } } = context;

            const Some{ value: ownInput } = tx.inputs.find( i => i.ref == spendingRef );
            const ownAddr = ownInput.resolved.address;
            const ownPolicy = ownAddr.payment.hash();

            // genuine nursery: holds exactly the undistributed markers. A
            // forged datum cannot pass — markers only exist here and on
            // hatched leaves (which pin theirs forever).
            const remaining = N_LEAFS - nextIdx;
            assert ownInput.resolved.value.amountOf( ownPolicy, LEAF_NFT_NAME ) == remaining;

            const initialChunk = std.builtins.replicateByte( CHUNK_SIZE, 255 );
            const initialCid = cidV1Raw( initialChunk );

            // marker-bearing outputs at this address, fixed order:
            // [0] the hatched leaf, [1] the continuing nursery (if any leaf
            // remains). Marker conservation: 1 + (remaining-1) accounts for
            // every marker in, so none can leak elsewhere.
            const ownOuts = tx.outputs.filter( o =>
                o.address == ownAddr
                && o.value.amountOf( ownPolicy, LEAF_NFT_NAME ) > 0
            );

            assert ownOuts[0].value.amountOf( ownPolicy, LEAF_NFT_NAME ) == 1;
            const InlineDatum{ datum: ld } = ownOuts[0].datum;
            const LeafNode{ idx: li, rawCid: lc, chunk: lch } = ld as Masterpiece;
            assert li == nextIdx;
            assert lc == initialCid;
            assert lch == initialChunk;

            if( nextIdx < N_LEAFS - 1 ) {
                assert ownOuts.length() == 2;
                assert ownOuts[1].value.amountOf( ownPolicy, LEAF_NFT_NAME ) == remaining - 1;
                const InlineDatum{ datum: nd } = ownOuts[1].datum;
                const Nursery{ nextIdx: nn } = nd as Masterpiece;
                assert nn == nextIdx + 1;
            } else {
                // last hatch: every marker now lives on a leaf
                assert ownOuts.length() == 1;
            }
        }
    }
}
`;

const LIB_IPFS = `// On-chain IPFS CIDv1 computation — byte-exact with \`ipfs add --cid-version=1 --raw-leaves\`
// (kubo / js-ipfs-unixfs-importer). Verified against generated golden vectors; see
// onchain/lib/ipfs_golden.test.pebble (produced by scripts that run the reference impl).
//
// A whole-file CID is the sha2-256 of a dag-pb (UnixFS) root node that links the raw-leaf
// chunks. Plutus has sha2_256 as a builtin (byte-identical to standard sha256, verified),
// so the only real work is reproducing IPFS's protobuf framing exactly:
//
//   leaf CID  = 0x01 0x55 0x12 0x20 || sha256(chunk)              (CIDv1, codec raw=0x55)
//   root node = [ PBLink per chunk (Links, field 2, first) ] || [ UnixFS Data (field 1) ]
//   PBLink    = 12 <len> | 0a 24 <36-byte CID> | 12 00 (empty Name) | 18 <varint Tsize>
//   UnixFS    = 08 02 (Type=File) | 18 <varint filesize> | { 20 <varint blocksize> }*
//   whole CID = 0x01 0x70 0x12 0x20 || sha256(root node)          (CIDv1, codec dag-pb=0x70)
//
// Assumes a single dag-pb root over raw leaves (file <= maxLinks*chunkSize, ~44 MiB at
// defaults). Deeper balanced DAGs reuse pbLink/uvarint over intermediate nodes (codec 0x70,
// Tsize = cumulative). The hard-coded \`0a 24\` assumes 36-byte CIDv1 hashes (always true here).

// one byte of value v (0..255) as a bytestring
function rb(v: int): bytes { return std.builtins.replicateByte(1, v); }

// LEB128 unsigned varint (supports values < 2^35 — ample for canvas byte sizes)
export function uvarint(n: int): bytes {
    let b0 = n % 128; let r0 = n / 128;
    let b1 = r0 % 128; let r1 = r0 / 128;
    let b2 = r1 % 128; let r2 = r1 / 128;
    let b3 = r2 % 128; let r3 = r2 / 128;
    let b4 = r3 % 128;
    return (r0 == 0) ? rb(b0)
        : (r1 == 0) ? std.bytes.concat(rb(b0 + 128), rb(b1))
        : (r2 == 0) ? std.bytes.concat(rb(b0 + 128), std.bytes.concat(rb(b1 + 128), rb(b2)))
        : (r3 == 0) ? std.bytes.concat(rb(b0 + 128), std.bytes.concat(rb(b1 + 128), std.bytes.concat(rb(b2 + 128), rb(b3))))
        : std.bytes.concat(rb(b0 + 128), std.bytes.concat(rb(b1 + 128), std.bytes.concat(rb(b2 + 128), std.bytes.concat(rb(b3 + 128), rb(b4)))));
}

// CIDv1 raw (leaf) from chunk content
export function cidV1Raw(content: bytes): bytes {
    return std.bytes.concat(#01551220, std.crypto.sha2_256(content));
}

// one PBLink (field 2 of the root): 12 <len> | 0a 24 <cid> | 12 00 | 18 <varint tsize>
export function pbLink(childCid: bytes, tsize: int): bytes {
    let body = std.bytes.concat(std.bytes.concat(std.bytes.concat(#0a24, childCid), #120018), uvarint(tsize));
    return std.bytes.concat(std.bytes.concat(#12, uvarint(body.length())), body);
}

// UnixFS Data message for a File: 08 02 | 18 <varint filesize> | { 20 <varint blocksize> }*
export function unixfsFile(filesize: int, blocksizes: List<int>): bytes {
    let acc = std.bytes.concat(#0802, std.bytes.concat(#18, uvarint(filesize)));
    for (let i = 0; i < blocksizes.length(); i = i + 1) {
        acc = std.bytes.concat(acc, std.bytes.concat(#20, uvarint(blocksizes[i])));
    }
    return acc;
}

// serialized dag-pb root node: all Links (field 2) first, then the Data field (field 1)
export function dagPbFileRoot(childCids: List<bytes>, tsizes: List<int>, filesize: int, blocksizes: List<int>): bytes {
    let links = #;
    for (let i = 0; i < childCids.length(); i = i + 1) {
        links = std.bytes.concat(links, pbLink(childCids[i], tsizes[i]));
    }
    let dat = unixfsFile(filesize, blocksizes);
    let dataField = std.bytes.concat(std.bytes.concat(#0a, uvarint(dat.length())), dat);
    return std.bytes.concat(links, dataField);
}

// whole-image CIDv1 (dag-pb, codec 0x70) over the raw-leaf chunks
export function wholeImageCid(childCids: List<bytes>, tsizes: List<int>, filesize: int, blocksizes: List<int>): bytes {
    return std.bytes.concat(#01701220, std.crypto.sha2_256(dagPbFileRoot(childCids, tsizes, filesize, blocksizes)));
}

// ---------------------------------------------------------------------------
// CIDv1 -> base32 multibase string ("bafy...") for the CIP-68 \`image\` field, so
// wallets/explorers display the whole image from standard metadata. RFC4648 base32
// (lowercase, no padding) + multibase prefix 'b'. Bit ops via /,% (Pebble has no <<,&).
// ---------------------------------------------------------------------------

// alphabet "abcdefghijklmnopqrstuvwxyz234567"; map a 5-bit index (0..31) to its char byte
function b32char(idx: int): bytes {
    return std.builtins.replicateByte(1,
        std.bytes.indexAt(#6162636465666768696a6b6c6d6e6f707172737475767778797a323334353637, idx));
}

// one 5-byte (40-bit) group -> 8 base32 chars
function b32group(d: bytes, off: int): bytes {
    let b0 = std.bytes.indexAt(d, off);
    let b1 = std.bytes.indexAt(d, off + 1);
    let b2 = std.bytes.indexAt(d, off + 2);
    let b3 = std.bytes.indexAt(d, off + 3);
    let b4 = std.bytes.indexAt(d, off + 4);
    return std.bytes.concat(
        std.bytes.concat(
            std.bytes.concat(b32char(b0 / 8), b32char((b0 % 8) * 4 + b1 / 64)),
            std.bytes.concat(b32char((b1 / 2) % 32), b32char((b1 % 2) * 16 + b2 / 16))),
        std.bytes.concat(
            std.bytes.concat(b32char((b2 % 16) * 2 + b3 / 128), b32char((b3 / 4) % 32)),
            std.bytes.concat(b32char((b3 % 4) * 8 + b4 / 32), b32char(b4 % 32))));
}

// base32 of a 36-byte CIDv1 (7 full groups + 1 leftover byte -> 58 chars), 'b'-prefixed
export function base32Cid(cid: bytes): bytes {
    let out = #62;                                  // multibase 'b'
    for (let g = 0; g < 7; g = g + 1) { out = std.bytes.concat(out, b32group(cid, g * 5)); }
    let b = std.bytes.indexAt(cid, 35);             // last byte -> 2 chars (8 bits, left-padded)
    return std.bytes.concat(out, std.bytes.concat(b32char(b / 8), b32char((b % 8) * 4)));
}

// CIP-68 \`image\` value: "ipfs://" + base32 CIDv1
export function cidToIpfsUri(cid: bytes): bytes {
    return std.bytes.concat(#697066733a2f2f, base32Cid(cid));   // "ipfs://" ++ bafy...
}
`;

const LIB_RECT = `// ===========================================================================
//  Rectangle utilities for the 1024x1024 canvas
// ===========================================================================
//
//  Rectangles are half-open: [x0,x1) × [y0,y1), with coords in 0..1024.

export const CANVAS_SIZE = 1024;

// half-open rectangle: [x0,x1) × [y0,y1)
export struct Coordinates {
    x0: int,
    y0: int,
    x1: int,
    y1: int
}

export function isValidRect( r: Coordinates ): boolean {
    return 0 <= r.x0 && r.x0 < r.x1 && r.x1 <= CANVAS_SIZE
        && 0 <= r.y0 && r.y0 < r.y1 && r.y1 <= CANVAS_SIZE;
}

export function rectContains( outer: Coordinates, inner: Coordinates ): boolean {
    return outer.x0 <= inner.x0 && inner.x1 <= outer.x1
        && outer.y0 <= inner.y0 && inner.y1 <= outer.y1;
}

export function rectArea( r: Coordinates ): int {
    return (r.x1 - r.x0) * (r.y1 - r.y0);
}

// \`a\` and \`b\` are a single straight (guillotine) cut of \`p\`, in order
// (a left of b, or a above b); strict inequalities forbid degenerate halves
export function isGuillotineCut( p: Coordinates, a: Coordinates, b: Coordinates ): boolean {
    const verticalCut =
        a.x0 == p.x0 && a.x1 == b.x0 && b.x1 == p.x1
        && a.y0 == p.y0 && a.y1 == p.y1
        && b.y0 == p.y0 && b.y1 == p.y1
        && a.x0 < a.x1 && b.x0 < b.x1;
    const horizontalCut =
        a.y0 == p.y0 && a.y1 == b.y0 && b.y1 == p.y1
        && a.x0 == p.x0 && a.x1 == p.x1
        && b.x0 == p.x0 && b.x1 == p.x1
        && a.y0 < a.y1 && b.y0 < b.y1;
    return verticalCut || horizontalCut;
}

// ---- coords -> asset name -------------------------------------------------
//
// Human-readable asset names: "masterpiece-x0-y0-x1-y1" in ASCII, canonical
// decimal (no leading zeros) — e.g. "masterpiece-0-0-1024-1024" — so wallets
// show both the collection and the plot at a glance. Canonical decimal +
// fixed '-' separators keep the encoding injective (a name splits into
// exactly four numbers), so a rect maps to exactly one name; worst case
// "masterpiece-1024-1024-1024-1024" is 31 bytes, just under the 32-byte
// asset-name limit. Consumers never parse names: they FORMAT a claimed rect
// and look the name up.

const NAME_PREFIX = #6d617374657270696563652d; // "masterpiece-"

function decDigit( d: int ): bytes {
    return std.builtins.replicateByte( 1, 48 + d ); // '0' + d
}

// canonical decimal for 0..9999 (ample for coords in 0..1024)
function decNum( v: int ): bytes {
    const last = decDigit( v % 10 );
    return v < 10 ? last
        : v < 100 ? std.bytes.concat( decDigit( v / 10 ), last )
        : v < 1000 ? std.bytes.concat(
            std.bytes.concat( decDigit( v / 100 ), decDigit( (v / 10) % 10 ) ), last )
        : std.bytes.concat(
            std.bytes.concat( decDigit( v / 1000 ), decDigit( (v / 100) % 10 ) ),
            std.bytes.concat( decDigit( (v / 10) % 10 ), last ) );
}

// "masterpiece-x0-y0-x1-y1"
export function rectName( r: Coordinates ): bytes {
    return std.bytes.concat(
        std.bytes.concat(
            NAME_PREFIX,                                                      // "masterpiece-"
            std.bytes.concat( decNum( r.x0 ), std.bytes.concat( #2d, decNum( r.y0 ) ) ) ), // "x0-y0"
        std.bytes.concat(
            std.bytes.concat( #2d, decNum( r.x1 ) ),                          // "-x1"
            std.bytes.concat( #2d, decNum( r.y1 ) ) )                         // "-y1"
    );
}
`;

jest.setTimeout( 120_000 );

describe("masterpiece bug 11 — custom natives must not survive to the forcing pass", () => {

    test("the full masterpiece contract compiles", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [ "masterpiece.pebble", fromUtf8( MASTERPIECE ) ],
                [ "lib/ipfs.pebble", fromUtf8( LIB_IPFS ) ],
                [ "lib/rect.pebble", fromUtf8( LIB_RECT ) ],
            ]),
            useConsoleAsOutput: true,
        });
        const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        await c.compile({ entry: "masterpiece.pebble", root: "/" });
        expect( c.diagnostics.map( d => d.toString() ) ).toEqual( [] );
        expect( ioApi.outputs.get("out/out.flat") instanceof Uint8Array ).toBe( true );
    });

    // bugs 13/14 regression (under-forced / double-forced builtins): every
    // builtin occurrence in the compiled output must sit under EXACTLY the
    // number of `force` wrappers its tag requires — an under-forced shared
    // binding (`[(λ f ...) (builtin tailList)]`) or a double-force both
    // fail on-chain at phase-2.
    test("compiled masterpiece has every builtin properly forced", async () => {
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [ "masterpiece.pebble", fromUtf8( MASTERPIECE ) ],
                [ "lib/ipfs.pebble", fromUtf8( LIB_IPFS ) ],
                [ "lib/rect.pebble", fromUtf8( LIB_RECT ) ],
            ]),
            useConsoleAsOutput: true,
        });
        const c = new Compiler( ioApi, { ...testOptions, compilerVersion: COMPILER_VERSION } );
        await c.compile({ entry: "masterpiece.pebble", root: "/" });
        const out = ioApi.outputs.get("out/out.flat");
        expect( out instanceof Uint8Array ).toBe( true );

        const offenders: string[] = [];
        const walk = ( term: any, forcesAbove: number ): void => {
            if( term instanceof Builtin )
            {
                // NOTE: `.tag` is the TERM kind (UPLCTermTag.Builtin); the
                // builtin id is `.builtinTag`
                const required = getNRequiredForces( term.builtinTag );
                if( forcesAbove !== required )
                    offenders.push( `builtin ${term.builtinTag}: required ${required} forces, got ${forcesAbove}` );
                return;
            }
            if( term instanceof Force ) return walk( term.forced, forcesAbove + 1 );
            // any other node resets the force chain for its children
            if( term instanceof Delay ) return walk( term.delayedTerm, 0 );
            if( term instanceof Lambda ) return walk( term.body, 0 );
            if( term instanceof Application ) { walk( term.func, 0 ); walk( term.arg, 0 ); return; }
            if( term instanceof Case ) { walk( term.constrTerm, 0 ); for( const b of term.continuations ) walk( b, 0 ); return; }
            if( term instanceof Constr ) { for( const f of term.terms ) walk( f, 0 ); return; }
            // vars / consts / errors: leaves
        };
        walk( parseUPLC( out! ).body, 0 );
        expect( offenders ).toEqual( [] );
    });
});
