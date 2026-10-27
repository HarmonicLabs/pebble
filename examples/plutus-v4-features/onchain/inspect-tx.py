"""Print the Plutus V4-era parts of a signed Dijkstra transaction and of its
sub-transactions: the new body fields and every redeemer with its ledger tag.

    python3 inspect-tx.py tx/nested.signed

Explorers may not know tag 6 (guarding) yet; this reads it from the
transaction itself. Tags (dijkstra.cddl): 0 spend, 1 mint, 2 cert,
3 reward, 4 voting, 5 proposing, 6 guarding.
"""
import hashlib
import json
import sys

TAGS = {0: "spend", 1: "mint", 2: "cert", 3: "reward", 4: "voting", 5: "proposing", 6: "guarding"}


def decode(b, i=0):
    ib = b[i]
    major, info = ib >> 5, ib & 31
    i += 1
    if info < 24:
        arg = info
    elif info == 31:
        arg = None
    else:
        size = {24: 1, 25: 2, 26: 4, 27: 8}[info]
        arg = int.from_bytes(b[i:i + size], "big")
        i += size
    if major == 0:
        return arg, i
    if major == 1:
        return -1 - arg, i
    if major in (2, 3):
        if arg is None:
            out = b""
            while b[i] != 0xFF:
                chunk, i = decode(b, i)
                out += chunk if isinstance(chunk, bytes) else chunk.encode()
            return out, i + 1
        return b[i:i + arg], i + arg
    if major == 4:
        out = []
        while (arg is None and b[i] != 0xFF) or (arg is not None and len(out) < arg):
            x, i = decode(b, i)
            out.append(x)
        return out, (i + 1 if arg is None else i)
    if major == 5:
        out = []
        while (arg is None and b[i] != 0xFF) or (arg is not None and len(out) < arg):
            k, i = decode(b, i)
            v, i = decode(b, i)
            out.append((k, v))
        return out, (i + 1 if arg is None else i)
    if major == 6:
        x, i = decode(b, i)
        return ("tag", arg, x), i
    if major == 7:
        return {20: False, 21: True, 22: None}.get(arg, arg), i


def end_of(b, i):
    """offset after the CBOR item at i"""
    return decode(b, i)[1]


def raw_items(b, i):
    """raw byte slices of the items of the array (or tagged array) at i"""
    if b[i] >> 5 == 6:                                       # tag (e.g. 258 for sets)
        i += 1 + {24: 1, 25: 2, 26: 4, 27: 8}.get(b[i] & 31, 0)
    major, info = b[i] >> 5, b[i] & 31
    assert major == 4
    if info == 31:
        i, out = i + 1, []
        while b[i] != 0xFF:
            j = end_of(b, i); out.append(b[i:j]); i = j
        return out
    n_size = {24: 1, 25: 2, 26: 4, 27: 8}.get(info, 0)
    n = info if info < 24 else int.from_bytes(b[i + 1:i + 1 + n_size], "big")
    i += 1 + n_size
    out = []
    for _ in range(n):
        j = end_of(b, i); out.append(b[i:j]); i = j
    return out


def ids(raw):
    """(transaction id, [sub-transaction ids]): blake2b-256 of each body"""
    tx = raw_items(raw, 0)
    body = tx[0]
    h = lambda x: hashlib.blake2b(x, digest_size=32).hexdigest()
    subs = []
    # walk the body map for key 23 (sub_transactions)
    major, info = body[0] >> 5, body[0] & 31
    i = 1 + {24: 1, 25: 2, 26: 4, 27: 8}.get(info, 0)
    n = info if info < 24 else int.from_bytes(body[1:i], "big")
    for _ in range(n):
        key, j = decode(body, i)
        k_end = j
        v_end = end_of(body, k_end)
        if key == 23:
            subs = [h(raw_items(st, 0)[0]) for st in raw_items(body, k_end)]
        i = v_end
    return h(body), subs


def untag(x):
    return x[2] if isinstance(x, tuple) and x[0] == "tag" else x


def plutus_data(x):
    x = untag(x) if not (isinstance(x, tuple) and x[0] == "tag" and 121 <= x[1] <= 127) else x
    if isinstance(x, tuple) and x[0] == "tag":
        return {"constructor": x[1] - 121, "fields": [plutus_data(f) for f in untag(x[2]) or []]}
    if isinstance(x, list):
        return [plutus_data(f) for f in x]
    if isinstance(x, bytes):
        return {"bytes": x.hex()}
    if isinstance(x, int):
        return {"int": x}
    return x


def redeemers(witness_set):
    for key, value in witness_set:
        if key != 5:
            continue
        if isinstance(value, list) and value and isinstance(value[0], tuple) and len(value[0]) == 2:
            for (tag, index), (data, units) in value:      # map form
                yield tag, index, data, units
        else:
            for tag, index, data, units in value:          # list form
                yield tag, index, data, units


def show(label, witness_set):
    for tag, index, data, units in redeemers(witness_set):
        print("%-30s tag %d (%s), index %d, redeemer %s, units %s" % (
            label, tag, TAGS.get(tag, "?"), index, json.dumps(plutus_data(data)), units))


FIELDS = {14: "guards", 24: "required top-level guards", 25: "direct deposits",
          26: "account balance intervals", 27: "starting account balance intervals"}


def readable(x):
    x = untag(x)
    if isinstance(x, bytes):
        return x.hex()
    if isinstance(x, list):
        return [readable(e) if not isinstance(e, tuple) or e[0] == "tag" else
                (readable(e[0]), readable(e[1])) for e in x]
    return x


def fields(label, body):
    for key, value in body:
        if key in FIELDS:
            print("%-30s body %d (%s): %s" % (label, key, FIELDS[key], readable(value)))


def main(path):
    raw = bytes.fromhex(json.load(open(path))["cborHex"])
    tx_id, sub_ids = ids(raw)
    print("%-30s id %s" % ("top-level transaction", tx_id))
    for n, sid in enumerate(sub_ids):
        print("%-30s id %s" % ("sub-transaction %d" % n, sid))
    tx, _ = decode(raw)
    body, witness_set = tx[0], tx[1]
    fields("top-level transaction", body)
    show("top-level transaction", witness_set)
    for key, value in body:
        if key == 23:                                       # sub_transactions
            for n, sub in enumerate(untag(value)):
                fields("sub-transaction %d" % n, sub[0])
                show("sub-transaction %d" % n, sub[1])


if __name__ == "__main__":
    main(sys.argv[1])
