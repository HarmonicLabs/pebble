import { semverSatisfies } from "../semverSatisfies";

describe("semverSatisfies", () => {
    test("exact match", () => {
        expect(semverSatisfies("0.2.0", "0.2.0")).toBe(true);
        expect(semverSatisfies("0.2.0", "0.2.1")).toBe(false);
        expect(semverSatisfies("1.0.0", "=1.0.0")).toBe(true);
    });

    test("wildcards", () => {
        expect(semverSatisfies("1.2.3", "*")).toBe(true);
        expect(semverSatisfies("0.0.0", "*")).toBe(true);
        expect(semverSatisfies("1.2.3", "x")).toBe(true);
        expect(semverSatisfies("1.2.3", "1.x")).toBe(true);
        expect(semverSatisfies("2.0.0", "1.x")).toBe(false);
        expect(semverSatisfies("1.2.3", "1.2.x")).toBe(true);
        expect(semverSatisfies("1.3.0", "1.2.x")).toBe(false);
    });

    test("comparators", () => {
        expect(semverSatisfies("0.2.0", ">=0.2.0")).toBe(true);
        expect(semverSatisfies("0.1.9", ">=0.2.0")).toBe(false);
        expect(semverSatisfies("0.2.1", ">0.2.0")).toBe(true);
        expect(semverSatisfies("0.2.0", ">0.2.0")).toBe(false);
        expect(semverSatisfies("0.2.0", "<=0.2.0")).toBe(true);
        expect(semverSatisfies("0.2.1", "<=0.2.0")).toBe(false);
        expect(semverSatisfies("0.1.9", "<0.2.0")).toBe(true);
        expect(semverSatisfies("0.2.0", "<0.2.0")).toBe(false);
    });

    test("caret range — pre-1.0 caret pins minor", () => {
        expect(semverSatisfies("0.2.0", "^0.2.0")).toBe(true);
        expect(semverSatisfies("0.2.5", "^0.2.0")).toBe(true);
        expect(semverSatisfies("0.3.0", "^0.2.0")).toBe(false);
        expect(semverSatisfies("0.1.0", "^0.2.0")).toBe(false);
    });

    test("caret range — post-1.0 caret pins major", () => {
        expect(semverSatisfies("1.2.3", "^1.2.3")).toBe(true);
        expect(semverSatisfies("1.5.0", "^1.2.3")).toBe(true);
        expect(semverSatisfies("2.0.0", "^1.2.3")).toBe(false);
        expect(semverSatisfies("1.2.2", "^1.2.3")).toBe(false);
    });

    test("caret range — ^0.0.x pins patch", () => {
        expect(semverSatisfies("0.0.3", "^0.0.3")).toBe(true);
        expect(semverSatisfies("0.0.4", "^0.0.3")).toBe(false);
    });

    test("tilde range", () => {
        expect(semverSatisfies("1.2.3", "~1.2.3")).toBe(true);
        expect(semverSatisfies("1.2.9", "~1.2.3")).toBe(true);
        expect(semverSatisfies("1.3.0", "~1.2.3")).toBe(false);
        expect(semverSatisfies("1.2.5", "~1.2")).toBe(true);
        expect(semverSatisfies("1.3.0", "~1.2")).toBe(false);
        expect(semverSatisfies("1.9.0", "~1")).toBe(true);
        expect(semverSatisfies("2.0.0", "~1")).toBe(false);
    });

    test("hyphen range", () => {
        expect(semverSatisfies("0.2.0", "0.2.0 - 0.3.0")).toBe(true);
        expect(semverSatisfies("0.3.0", "0.2.0 - 0.3.0")).toBe(true);
        expect(semverSatisfies("0.3.1", "0.2.0 - 0.3.0")).toBe(false);
        expect(semverSatisfies("0.1.9", "0.2.0 - 0.3.0")).toBe(false);
        expect(semverSatisfies("1.2.5", "1.2 - 1.3")).toBe(true);
        expect(semverSatisfies("1.4.0", "1.2 - 1.3")).toBe(false);
    });

    test("AND of comparators", () => {
        expect(semverSatisfies("0.2.5", ">=0.2.0 <0.3.0")).toBe(true);
        expect(semverSatisfies("0.3.0", ">=0.2.0 <0.3.0")).toBe(false);
        expect(semverSatisfies("0.1.9", ">=0.2.0 <0.3.0")).toBe(false);
    });

    test("OR of ranges", () => {
        expect(semverSatisfies("0.2.0", "^0.1.0 || ^0.2.0")).toBe(true);
        expect(semverSatisfies("0.1.5", "^0.1.0 || ^0.2.0")).toBe(true);
        expect(semverSatisfies("0.3.0", "^0.1.0 || ^0.2.0")).toBe(false);
    });

    test("malformed input returns false", () => {
        expect(semverSatisfies("garbage", "^0.2.0")).toBe(false);
        expect(semverSatisfies("0.2.0", "garbage")).toBe(false);
        expect(semverSatisfies("0.2", "^0.2.0")).toBe(false);
        expect(semverSatisfies("0.2.0", "")).toBe(false);
    });

    test("prerelease/build metadata in range is dropped (numeric core compared)", () => {
        expect(semverSatisfies("0.2.0", "^0.2.0-beta")).toBe(true);
        expect(semverSatisfies("0.2.0", "0.2.0+build.1")).toBe(true);
    });
});
