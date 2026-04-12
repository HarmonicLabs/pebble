import { defaultOptions, testOptions } from "../../IR/toUPLC/CompilerOptions";
import { createMemoryCompilerIoApi } from "../io/CompilerIoApi";
import { Compiler } from "../Compiler";
import { fromHex, fromUtf8, toHex } from "@harmoniclabs/uint8array-utils";
import { Application, constT, parseUPLC, prettyUPLC, UPLCConst } from "@harmoniclabs/uplc";
import { CEKConst, CEKError, DataB, DataConstr, DataI, DataMap, Hash28, Machine, Value } from "@harmoniclabs/buildooor";

const policyHex = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("amountOf", () => {

    test("single entry ok", async () => {





        const fileName = "test.pebble";
        const srcText = `
data struct WrappedValue {
    value: Value
}

function getAmtA( wrapped: WrappedValue ): boolean {
    return wrapped.value[#${policyHex}].every(({ value }) => value == 42 )
}
`;

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [fileName, fromUtf8(srcText)],
            ]),
            useConsoleAsOutput: true,
        });
        // const complier = new Compiler( ioApi, defaultOptions );
        const complier = new Compiler(ioApi, testOptions);

        await complier.export({ functionName: "getAmtA", entry: fileName, root: "/" });
        const diagnostics = complier.diagnostics;

        const outputBytes = ioApi.outputs.get("out/out.flat")!;
        const uplc = parseUPLC(outputBytes).body;

        // console.log( diagnostics );
        // console.log( diagnostics.map( d => d.toString() ) );
        expect(diagnostics.length).toBe(0);

        // console.log( prettyUPLC( parseUPLC( output ).body, 2 ) )
        expect(outputBytes instanceof Uint8Array).toBe(true);

        // console.log( output.length, toHex( output ) );

        const applied_1 = new Application(
            uplc,
            getValueUplc(
                Value.singleAsset(
                    policyHex,
                    fromHex(""),
                    42n
                )
            )
        );
        const result_1 = Machine.eval(applied_1);
        expect(result_1.result instanceof CEKConst).toBe(true);
        expect(( result_1.result as CEKConst).value ).toBe( true );

        const applied_2 = new Application(
            uplc,
            getValueUplc(
                Value.singleAsset(
                    policyHex,
                    fromHex("01"),
                    42n
                )
            )
        );
        const result_2 = Machine.eval(applied_2);
        expect(result_2.result instanceof CEKConst).toBe(true);
        expect(( result_2.result as CEKConst).value ).toBe( true );

        const applied_3 = new Application(
            uplc,
            getValueUplc(
                Value.singleAsset(
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    fromHex(""),
                    42n
                )
            )
        );
        const result_3 = Machine.eval(applied_3);
        // map[key] fails when key not found (lookup(key)! semantics)
        expect(result_3.result instanceof CEKError).toBe(true);

        const result_4 = Machine.eval(
            new Application(
                uplc,
                getValueUplc(
                    new Value([
                        Value.lovelaceEntry(1000n),
                        Value.singleAssetEntry(
                            policyHex,
                            fromHex(""),
                            42n
                        )
                    ])
                )
            )
        );
        expect(result_4.result instanceof CEKConst).toBe(true);
        expect(( result_4.result as CEKConst).value ).toBe( true );

        const result_5 = Machine.eval(
            new Application(
                uplc,
                getValueUplc(
                    new Value([
                        Value.lovelaceEntry(1000n),
                        Value.singleAssetEntry(
                            "00".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        Value.singleAssetEntry(
                            "11".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        Value.singleAssetEntry(
                            "22".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        Value.singleAssetEntry(
                            policyHex,
                            fromHex(""),
                            42n
                        )
                    ])
                )
            )
        );
        expect(result_5.result instanceof CEKConst).toBe(true);
        expect(( result_5.result as CEKConst).value ).toBe( true );

        const result_6 = Machine.eval(
            new Application(
                uplc,
                getValueUplc(
                    new Value([
                        Value.lovelaceEntry(1000n),
                        Value.singleAssetEntry(
                            "00".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        Value.singleAssetEntry(
                            "11".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        Value.singleAssetEntry(
                            "22".repeat(28),
                            fromHex(""),
                            42n
                        ),
                    ])
                )
            )
        );
        // policy not in value → map[key] fails (lookup(key)! semantics)
        expect(result_6.result instanceof CEKError).toBe(true);

        const result_7 = Machine.eval(
            new Application(
                uplc,
                getValueUplc(
                    new Value([
                        Value.lovelaceEntry(1000n),
                        Value.singleAssetEntry(
                            "00".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        Value.singleAssetEntry(
                            "11".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        Value.singleAssetEntry(
                            "22".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        {
                            policy: new Hash28(policyHex),
                            assets: [
                                {
                                    name: fromHex("00"),
                                    quantity: 42n
                                },
                                {
                                    name: fromHex("40"),
                                    quantity: 42n
                                },
                                {
                                    name: fromHex("41"),
                                    quantity: 42n
                                }
                            ]
                        }
                    ])
                )
            )
        );
        expect(result_7.result instanceof CEKConst).toBe(true);
        expect(( result_7.result as CEKConst).value ).toBe( true );

        const result_8 = Machine.eval(
            new Application(
                uplc,
                getValueUplc(
                    new Value([
                        Value.lovelaceEntry(1000n),
                        Value.singleAssetEntry(
                            "00".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        Value.singleAssetEntry(
                            "11".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        Value.singleAssetEntry(
                            "22".repeat(28),
                            fromHex(""),
                            42n
                        ),
                        {
                            policy: new Hash28(policyHex),
                            assets: [
                                {
                                    name: fromHex("00"),
                                    quantity: 42n
                                },
                                {
                                    name: fromHex("40"),
                                    quantity: 42n
                                },
                                {
                                    name: fromHex("41"),
                                    quantity: 69n
                                }
                            ]
                        }
                    ])
                )
            )
        );
        expect(result_8.result instanceof CEKConst).toBe(true);
        expect(( result_8.result as CEKConst).value ).toBe( false );
    });

});

function getValueUplc(value: Value): UPLCConst {
    /*
    return UPLCConst.listOf(constT.pairOf(
        constT.data,
        constT.data
    ))(
        Array.from(value.map)
        .map(({ policy, assets }) => {
            assets = assets.filter(({ quantity }) => quantity > 0n);
            if( assets.length === 0 ) return null;
            return {
                fst: new DataB(fromHex(policy.toString())),
                snd: new DataMap(
                    assets.map(({ name, quantity }) => ({
                        fst: new DataB(name),
                        snd: new DataI(quantity)
                    }))
                )
            }
        })
        .filter(x => !!x)
    );
    /*/
    return UPLCConst.data(
        new DataConstr( 0, [
            value.toData("v3")
        ])
    );
    //*/
}