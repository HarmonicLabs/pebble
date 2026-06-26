import { getUniqueInternalName } from "../../compiler/internalVar";
import { CharCode } from "../../utils/CharCode";
import { TopLevelStmt } from "../nodes/statements/PebbleStmt";
import { SourceRange } from "./SourceRange";

/** Indicates the specific kind of a source. */
export enum SourceKind {
    /** User-provided file. */
    User = 0,
    /** User-provided entry file. */
    UserEntry = 1,
    /** Library-provided file. */
    Library = 2,
    /** Library-provided entry file. */
    LibraryEntry = 3
}

Object.freeze(SourceKind);

/** A top-level source node. */
export class Source {

    readonly range: SourceRange;

    constructor(
        /** Source kind. */
        public sourceKind: SourceKind,
        /** Normalized path with file extension. */
        public absoluteProjPath: string,
        /** unique identifier for the source */
        readonly uid: string,
        /** Full source text. */
        public text: string
    ) {
        this.range = new SourceRange(this, 0, text.length);
        this.statements = new Array();
    }

    static get mock(): Source {
        return new Source(
            SourceKind.LibraryEntry,
            "mock.pebble",
            getUniqueInternalName("mock"),
            ""
        );
    }

    /** Contained statements. */
    statements: TopLevelStmt[];

    /** Checks if this source is part of the (standard) library. */
    isLibrary(): boolean {
        let kind = this.sourceKind;
        return kind === SourceKind.Library || kind === SourceKind.LibraryEntry;
    }

    /** Cached line starts. */
    private lineCache: number[] | undefined = undefined;

    /** Remembered column number. */
    private lineColumn: number = 1;

    /** Determines the line number at the specified position. Starts at `1`. */
    lineAt(pos: number): number {
        // Synthetic / internal nodes carry mock ranges (`SourceRange.mock` uses
        // -1) and some positions can point past the end of the text. Clamp
        // instead of throwing, otherwise printing a single diagnostic on such a
        // node crashes the whole diagnostic pass and hides every later error.
        if( pos < 0 ) pos = 0;
        if( pos >= 0x7fffffff ) pos = Math.max( 0, this.text.length );
        let lineCache = this.lineCache;
        if (!lineCache) {
            this.lineCache = lineCache = [0];
            let text = this.text;
            let off = 0;
            let end = text.length;
            while (off < end) {
                if (text.charCodeAt(off++) === CharCode.LineFeed) lineCache.push(off);
            }
            lineCache.push(0x7fffffff);
        }
        let l = 0;
        let r = lineCache.length - 1;
        while (l < r) {
            let m = l + ((r - l) >> 1);
            let s = (lineCache[m]);
            if (pos < s) r = m;
            else if (pos < (lineCache[m + 1])) {
                this.lineColumn = pos - s + 1;
                return m + 1;
            }
            else l = m + 1;
        }
        throw new Error("[unreachable] invalid pos");
    }

    /** Gets the column number at the last position queried with `lineAt`. Starts at `1`. */
    columnAt(): number {
        return this.lineColumn;
    }
}
