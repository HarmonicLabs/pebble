import { fromUtf8 } from "@harmoniclabs/uint8array-utils";

async function compileSrc(srcText: string): Promise<{ diagnostics: any[], output: Uint8Array | undefined }> {
    let result: { diagnostics: any[], output: Uint8Array | undefined } = {
        diagnostics: [],
        output: undefined,
    };
    await jest.isolateModulesAsync(async () => {
        const { Compiler } = require("../Compiler");
        const { createMemoryCompilerIoApi } = require("../io/CompilerIoApi");
        const { testOptions } = require("../../IR/toUPLC/CompilerOptions");

        const fileName = "test.pebble";
        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([[fileName, fromUtf8(srcText)]]),
            useConsoleAsOutput: true,
        });
        const compiler = new Compiler( ioApi, testOptions );
        try {
            await compiler.compile({ entry: fileName, root: "/" });
        } catch {
            // ignore - we read diagnostics ourselves below
        }
        result = {
            diagnostics: compiler.diagnostics.slice(),
            output: ioApi.outputs.get("out/out.flat"),
        };
    });
    return result;
}

describe("contract `state` blocks", () => {

    test("single state block compiles", async () => {
        const { diagnostics, output } = await compileSrc(`
contract OneState {
    state Counter {
        value: int

        spend bump() {}
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("multi-state contract with plain spend fallback compiles", async () => {
        const { diagnostics, output } = await compileSrc(`
contract MultiState {
    state Simple {
        owner: bytes

        spend fill() {}
    }
    state Partial {
        owner: bytes
        amount: int

        spend fill() {}
    }
    spend cancel() {}
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("readonly state (no spend methods) compiles", async () => {
        const { diagnostics, output } = await compileSrc(`
contract Oracle {
    state Feed {
        price: int
    }
    spend admin() {}
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("state without plain spend (only-state) compiles", async () => {
        const { diagnostics, output } = await compileSrc(`
contract OnlyState {
    state A {
        x: int

        spend ok() {}
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("destructuring `state` from context compiles", async () => {
        const { diagnostics, output } = await compileSrc(`
contract WithStateAccess {
    state Counter {
        value: int

        spend useState() {
            const { state } = context;
            assert state.value > 0;
        }
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("multi-state with state.field access narrows correctly", async () => {
        const { diagnostics, output } = await compileSrc(`
contract TwoStateAccess {
    state A {
        x: int
        spend run() {
            const { state } = context;
            assert state.x > 0;
        }
    }
    state B {
        y: int
        spend run() {
            const { state } = context;
            assert state.y > 0;
        }
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("orderbook-style example (two states + plain methods) compiles", async () => {
        const { diagnostics, output } = await compileSrc(`
contract SimpleOrderBook {
    state Simple {
        ownerHash: bytes
        policy: bytes
        tokenName: bytes
        minReceiveAmount: int

        spend fill(
            inputIdx: int,
            outputIdx: int
        ) {
            const { state } = context;
            assert state.minReceiveAmount > 0;
        }
    }
    state Partial {
        ownerHash: bytes
        policy: bytes
        tokenName: bytes
        minReceiveAmountPerTx: int

        spend fill(
            inputIdx: int,
            outputIdx: int
        ) {
            const { state } = context;
            assert state.minReceiveAmountPerTx > 0;
        }
    }

    spend cancelOrder() {}
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("destructure state from context (nested deconstruct)", async () => {
        const { diagnostics, output } = await compileSrc(`
contract DestructState {
    state Counter {
        value: int
        owner: bytes

        spend run() {
            const { state: { value, owner } } = context;
            assert value > 0;
            assert owner.length() > 0;
        }
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("destructure state after assignment from context", async () => {
        const { diagnostics, output } = await compileSrc(`
contract DestructState2 {
    state Counter {
        value: int
        owner: bytes

        spend run() {
            const { state } = context;
            const { value, owner } = state;
            assert value > 0;
            assert owner.length() > 0;
        }
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("destructure narrowed type after match arm", async () => {
        const { diagnostics } = await compileSrc(`
struct M {
    A{ x: int, y: int }
    B{ k: int }
}

contract C {
    spend run() {
        const m: M = M.A{ x: 1, y: 2 };
        match (m) {
            when A{ x: ax, y: ay }: {
                const { x, y } = m;
                assert x + y > 0;
                fail;
            }
            when B{ k: bk }: { fail; }
        }
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
    });

    test("destructure narrowed function parameter after match arm", async () => {
        const { diagnostics } = await compileSrc(`
struct M {
    A{ x: int, y: int }
    B{ k: int }
}

function pickSum(m: M): int {
    match (m) {
        when A{ x: ax, y: ay }: {
            const { x, y } = m;
            return x + y;
        }
        when B{ k: bk }: { return bk; }
    }
    return 0;
}

contract C {
    spend run() {
        const total: int = pickSum(M.A{ x: 1, y: 2 });
        assert total > 0;
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
    });

    test("destructure narrowed type after `is` assertion", async () => {
        const { diagnostics } = await compileSrc(`
struct M {
    A{ x: int, y: int }
    B{ k: int }
}

contract C {
    spend run() {
        const m: M = M.A{ x: 1, y: 2 };
        assert m is A;
        const { x, y } = m;
        assert x + y > 0;
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
    });

    test("contract name is usable as the union datum type", async () => {
        const { diagnostics, output } = await compileSrc(`
contract OrderBook {
    state SimpleOrder {
        value: int
        spend fill() {
            const order: OrderBook = OrderBook.SimpleOrder{ value: 0 };
            assert order is SimpleOrder;
        }
    }
    state PartialOrder {
        value: int
        spend fill() {}
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("contract name accepts every state constructor", async () => {
        const { diagnostics, output } = await compileSrc(`
contract Multi {
    state A {
        x: int
        spend run() {
            const a: Multi = Multi.A{ x: 1 };
            const b: Multi = Multi.B{ y: 2 };
            assert a is A;
            assert b is B;
        }
    }
    state B {
        y: int
        spend run() {}
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("contract name is usable as `as` cast target", async () => {
        const { diagnostics, output } = await compileSrc(`
contract Cast {
    state A {
        v: int
        spend run() {
            const datum = Cast.A{ v: 0 };
            const widened = datum as Cast;
            assert widened is A;
        }
    }
    state B {
        w: int
        spend run() {}
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("contract type narrows via `is` to a specific state", async () => {
        const { diagnostics, output } = await compileSrc(`
contract Narrow {
    state A {
        x: int
        spend run() {
            const d: Narrow = Narrow.A{ x: 1 };
            assert d is A;
            const { x } = d;
            assert x > 0;
        }
    }
    state B {
        y: int
        spend run() {}
    }
}
        `);
        expect( diagnostics.length ).toBe( 0 );
        expect( output instanceof Uint8Array ).toBe( true );
    });

    test("constructing a wrong state shape is rejected", async () => {
        const { diagnostics } = await compileSrc(`
contract WrongShape {
    state A {
        x: int
        spend run() {
            // missing field 'x' on A
            const bad: WrongShape = WrongShape.A{ y: 1 };
        }
    }
    state B {
        y: int
        spend run() {}
    }
}
        `);
        expect( diagnostics.length ).toBeGreaterThan( 0 );
    });

    test("referring to a non-existent state constructor is rejected", async () => {
        const { diagnostics } = await compileSrc(`
contract NoSuchState {
    state A {
        x: int
        spend run() {
            const bad: NoSuchState = NoSuchState.Missing{ x: 1 };
        }
    }
    state B {
        y: int
        spend run() {}
    }
}
        `);
        expect( diagnostics.length ).toBeGreaterThan( 0 );
    });

    test("duplicate state names are rejected", async () => {
        const { diagnostics } = await compileSrc(`
contract DupStates {
    state Foo {
        x: int
        spend a() {}
    }
    state Foo {
        y: int
        spend b() {}
    }
}
        `);
        expect( diagnostics.length ).toBeGreaterThan( 0 );
    });
});
