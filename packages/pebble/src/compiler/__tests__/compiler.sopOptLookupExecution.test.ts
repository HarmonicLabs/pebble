import { testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromUtf8 } from "@harmoniclabs/uint8array-utils";
import { Application, parseUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { DataB, DataConstr, DataI, DataList, DataMap, DataPair } from "@harmoniclabs/plutus-data";
import { CEKError, ExBudget, Machine } from "@harmoniclabs/plutus-machine";

const FH = new Uint8Array(32);
const VP = new Uint8Array(28); VP.fill(0xAA);
const GAID = new DataConstr(0, [ new DataB(FH), new DataI(0) ]);
const VC = new DataConstr(0, [ new DataB(VP) ]);
const VOTER = new DataConstr(1, [ VC ]);
const DN = new DataConstr(1, []);
const IV = new DataConstr(0, [
    new DataConstr(0, [ new DataConstr(0,[]), new DataConstr(1,[]) ]),
    new DataConstr(0, [ new DataConstr(2,[]), new DataConstr(1,[]) ])
]);

function mkTx(votes: any) {
    return new DataConstr(0, [
        new DataList([]),new DataList([]),new DataList([]),
        new DataI(0),new DataMap([]),new DataList([]),new DataMap([]),
        IV, new DataList([]),new DataMap([]),new DataMap([]),
        new DataB(FH), votes, new DataList([]), DN, DN
    ]);
}
function mkCtx(t: DataConstr, d: DataConstr) {
    const ref = new DataConstr(0, [new DataB(FH), new DataI(0)]);
    return new DataConstr(0, [t, new DataConstr(0,[]), new DataConstr(1,[ref,d])]);
}

function evalBudgeted(term: any) {
    const m = new Machine(
        undefined,
        new ExBudget({ cpu: BigInt(100_000_000), mem: BigInt(1_000_000) })
    );
    return m.eval(term).result;
}

describe("SoP Optional / lookup execution", () => {

    /**
     * Regression test for three compiler bugs that caused CEK machine crashes
     * instead of clean script errors:
     *
     * Bug 1: hoisted_lookupLinearMap / hoisted_findSopOptional cons case
     *        lacked headList application and used wrong Some constructor index.
     *        Before fix: returned a lambda → "case: expected constr, got 2"
     *
     * Bug 2: _dataStructToIR for TirDataOptT had a spurious IRForced wrapper.
     *        Before fix: "NonPolymorphicInstantiation: cannot force Error"
     *
     * Bug 3: _sopStructToIR for SoP Optional unwrap didn't apply _inlineFromData.
     *        Before fix: chooseList received raw Data → "chooseList :: not a list"
     *
     * The contract exercises all three:
     *   - Data Optional datum destructuring (bug 2)
     *   - tx.votes.lookup(voter)           (bug 1)
     *   - optVoter!.lookup(govActionId)    (bug 3)
     */
    test("lookup chain: success path and clean failure paths", async () => {

        const io = createMemoryCompilerIoApi({
            sources: new Map([[ "t.pebble", fromUtf8(`
contract VoteLookup {
    param govActionId: TxOutRef;
    spend check() {
        const { tx, optionalDatum: Some{ value: vc as Credential } } = context;
        const ev: Voter = Voter.DRep{ credential: vc };
        assert tx.votes.lookup( ev )!.lookup( this.govActionId );
    }
}`) ]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler(io, testOptions);
        await compiler.compile({ entry: "t.pebble", root: "/" });
        expect(compiler.diagnostics.length).toBe(0);
        const flat = io.outputs.get("out/out.flat")! as Uint8Array;
        const { body } = parseUPLC(flat);

        function run(votes: any) {
            const c = mkCtx(mkTx(votes), new DataConstr(0, [VC]));
            return evalBudgeted(
                new Application(new Application(body, UPLCConst.data(GAID)), UPLCConst.data(c))
            );
        }

        // ── SUCCESS: voter present, govActionId present ──
        const fullVotes = new DataMap([
            new DataPair(VOTER, new DataMap([new DataPair(GAID, new DataConstr(1,[]))]))
        ]);
        const ok = run(fullVotes);
        expect(ok instanceof CEKError).toBe(false);

        // ── BUG 1: voter missing → clean error, not "case: expected constr, got 2" ──
        const missingVoter = run(new DataMap([]));
        expect(missingVoter instanceof CEKError).toBe(true);
        expect((missingVoter as CEKError).msg).not.toContain("case: expected constr");

        // ── BUG 3: govActionId missing → clean error, not "chooseList :: not a list" ──
        const missingGovAction = run(new DataMap([new DataPair(VOTER, new DataMap([]))]));
        expect(missingGovAction instanceof CEKError).toBe(true);
        expect((missingGovAction as CEKError).msg).not.toContain("not a list");
        expect((missingGovAction as CEKError).msg).not.toContain("case: expected constr");
    });
});
