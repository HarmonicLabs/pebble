"""Give a top-level transaction a Plutus script guard.

    python3 copy-guard-witness.py TOP.raw TEMPLATE.raw OUT.raw

cardano-cli only accepts script guards on sub-transactions, so the guard is
built on a TEMPLATE sub-transaction (`sub-transaction build-raw
--guard-script-file ...`, never submitted) and copied into TOP, an unsigned
top-level transaction from `transaction build-raw`:

    body     14 guards            11 script_data_hash
    witness   5 redeemers          8 plutus_v4_scripts

The script data hash covers the redeemers, the datums and the cost models
of the languages used. TOP gets exactly the template's redeemers, no datums
and the same Plutus V4 script, so the template's hash is TOP's hash. The
guard is the only guard in both, so its redeemer index (0) is the same.
Every other byte of TOP is left as it is. Sign OUT.raw afterwards.
"""
import json
import sys


def head(b, i):
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
    major, arg, i = head(b, i)
    if arg is None:                        # indefinite length
        while b[i] != 0xFF:
            i = skip(b, i)
        return i + 1
    if major in (0, 1, 7):
        return i
    if major in (2, 3):
        return i + arg
    if major in (4, 5):
        for _ in range(arg * (2 if major == 5 else 1)):
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


def entries(b, i):
    """(entries of the map at i as [(key, raw key+value bytes)], end offset)"""
    major, n, i = head(b, i)
    assert major == 5, "expected a map"
    out = []
    for _ in range(n):
        start = i
        _, key, _ = head(b, i)
        i = skip(b, skip(b, i))
        out.append((key, b[start:i]))
    return out, i


def items(b):
    """offsets of the array's items, and the array's end"""
    major, n, i = head(b, 0)
    assert major == 4, "expected an array"
    starts = []
    for _ in range(n):
        starts.append(i)
        i = skip(b, i)
    return starts, i


def main(top_path, template_path, out_path):
    top_env = json.load(open(top_path))
    top = bytes.fromhex(top_env["cborHex"])
    template = bytes.fromhex(json.load(open(template_path))["cborHex"])

    t_starts, _ = items(template)
    t_body, _ = entries(template, t_starts[0])
    t_wits, _ = entries(template, t_starts[1])
    take_body = [e for e in t_body if e[0] in (11, 14)]
    take_wits = [e for e in t_wits if e[0] in (5, 8)]
    assert len(take_body) == 2 and len(take_wits) == 2, \
        "the template needs a script guard with its redeemer: body 11, 14 and witness 5, 8"

    starts, end = items(top)
    body, body_end = entries(top, starts[0])
    wits, wits_end = entries(top, starts[1])
    assert not {k for k, _ in body} & {11, 14}, "TOP already has guards or a script data hash"
    assert not {k for k, _ in wits} & {5, 8}, "TOP already has redeemers or V4 scripts"

    new_body = enc_head(5, len(body) + 2) + b"".join(r for _, r in body + take_body)
    new_wits = enc_head(5, len(wits) + 2) + b"".join(r for _, r in wits + take_wits)
    out = top[:starts[0]] + new_body + new_wits + top[wits_end:]
    assert out[0] == top[0]
    top_env["cborHex"] = out.hex()
    json.dump(top_env, open(out_path, "w"), indent=4)
    print("copied body %s and witness %s from the template" % (
        [k for k, _ in take_body], [k for k, _ in take_wits]))


if __name__ == "__main__":
    main(*sys.argv[1:4])
