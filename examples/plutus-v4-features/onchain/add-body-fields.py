"""Add Dijkstra transaction body fields that cardano-cli has no options for.

    python3 add-body-fields.py IN.raw OUT.raw \
        [--direct-deposit HEX_REWARD_ACCOUNT:LOVELACE]... \
        [--account-balance-interval HEX_REWARD_ACCOUNT:LOWER:UPPER]...

IN.raw is an unsigned transaction from `cardano-cli dijkstra transaction
build-raw`. The fields are appended to the body map as

    25 : direct_deposits           = {+ reward_account => coin}
    26 : account_balance_intervals = {+ reward_account => [lower, upper]}

(dijkstra.cddl); nothing else is re-encoded, so the witness set, the
redeemers and the script data hash stay byte-for-byte as cardano-cli built
them. Sign OUT.raw afterwards: the signature covers the extended body.
"""
import json
import sys


def head(b, i):
    """(major type, argument, offset after the head) of the item at i"""
    ib = b[i]
    major, info = ib >> 5, ib & 31
    if info < 24:
        return major, info, i + 1
    if info == 31 and major in (2, 3, 4, 5):
        return major, None, i + 1          # indefinite length, ends at 0xff
    size = {24: 1, 25: 2, 26: 4, 27: 8}.get(info)
    if size is None:
        raise ValueError("reserved CBOR item at offset %d" % i)
    return major, int.from_bytes(b[i + 1:i + 1 + size], "big"), i + 1 + size


def skip(b, i):
    """offset after the CBOR item starting at i"""
    major, arg, i = head(b, i)
    if arg is None:                        # indefinite length
        while b[i] != 0xFF:
            i = skip(b, i)
        return i + 1
    if major in (0, 1, 7):
        return i
    if major in (2, 3):
        return i + arg
    if major == 4:
        for _ in range(arg):
            i = skip(b, i)
        return i
    if major == 5:
        for _ in range(2 * arg):
            i = skip(b, i)
        return i
    if major == 6:
        return skip(b, i)
    raise ValueError("unexpected major type %d" % major)


def enc_head(major, n):
    if n < 24:
        return bytes([(major << 5) | n])
    for info, size in ((24, 1), (25, 2), (26, 4), (27, 8)):
        if n < 1 << (8 * size):
            return bytes([(major << 5) | info]) + n.to_bytes(size, "big")
    raise ValueError(n)


def uint(n):
    return enc_head(0, n)


def bstr(x):
    return enc_head(2, len(x)) + x


def main(argv):
    src, dst, rest = argv[0], argv[1], argv[2:]
    deposits, intervals = [], []
    for flag, value in zip(rest[0::2], rest[1::2]):
        parts = value.split(":")
        account = bytes.fromhex(parts[0])
        if len(account) != 29:
            raise SystemExit("a reward account is 29 bytes: header + 28-byte credential hash")
        if flag == "--direct-deposit":
            deposits.append((account, int(parts[1])))
        elif flag == "--account-balance-interval":
            intervals.append((account, int(parts[1]), int(parts[2])))
        else:
            raise SystemExit("unknown option " + flag)

    envelope = json.load(open(src))
    tx = bytes.fromhex(envelope["cborHex"])
    major, n_items, body_start = head(tx, 0)
    assert major == 4 and n_items in (3, 4), "not a transaction"
    major, n_fields, fields_start = head(tx, body_start)
    assert major == 5, "transaction body is not a map"
    i, keys = fields_start, []
    for _ in range(n_fields):
        _, key, _ = head(tx, i)
        keys.append(key)
        i = skip(tx, skip(tx, i))
    body_end = i

    added = b""
    if deposits:
        assert 25 not in keys, "body already has direct deposits"
        added += uint(25) + enc_head(5, len(deposits)) + b"".join(
            bstr(a) + uint(c) for a, c in deposits)
    if intervals:
        assert 26 not in keys, "body already has account balance intervals"
        added += uint(26) + enc_head(5, len(intervals)) + b"".join(
            bstr(a) + enc_head(4, 2) + uint(lo) + uint(hi) for a, lo, hi in intervals)
    extra = (1 if deposits else 0) + (1 if intervals else 0)

    out = (tx[:body_start] + enc_head(5, n_fields + extra)
           + tx[fields_start:body_end] + added + tx[body_end:])
    envelope["cborHex"] = out.hex()
    json.dump(envelope, open(dst, "w"), indent=4)
    print("added body fields %s (%d bytes)" % (
        [k for k, on in ((25, deposits), (26, intervals)) if on], len(added)))


if __name__ == "__main__":
    main(sys.argv[1:])
