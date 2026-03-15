import { fromUtf8, toUtf8 } from "@harmoniclabs/uint8array-utils";
import { DiagnosticMessage } from "../../diagnostics/DiagnosticMessage";
import { MaybePromise } from "../../utils/MaybePromise";
import { ConsoleErrorStream, ConsoleLogStream, IOutputStream, MemoryStream } from "./IOutputStream";
import { getAbsolutePath } from "../path/getAbsolutePath";

/** Compiler API options. */
export interface CompilerIoApi {
    /** Standard output stream to use. */
    stdout: IOutputStream;
    /** Standard error stream to use. */
    readonly stderr: IOutputStream;
    /** Reads a file from disk (or memory). */
    readFile: (filename: string, baseDir: string) => MaybePromise<string | undefined>;
    /** Writes a file to disk (or memory). */
    writeFile: (filename: string, contents: Uint8Array | string, baseDir: string) => MaybePromise<void>;
    /** Lists all files within a directory. */
    exsistSync: (filename: string) => boolean;
    /** Lists all files within a directory. */
    listFiles: (dirname: string, baseDir: string) => MaybePromise<string[] | undefined>;
    /** Handler for diagnostic messages. */
    reportDiagnostic: (diagnostic: DiagnosticMessage) => void;
}

type MemoryFs = Map<string, Uint8Array>;

export interface MemoryCompilerIoApi extends CompilerIoApi {
    /** Memory file system for reading files. */
    sources: MemoryFs;
    /** Memory file system for writing files. */
    outputs: MemoryFs;
    /**
     * if true, `console.log` is used as `stdout` and `console.error` as `stderr`
     * otherwise both will be their own `MemoryStream`.
     * 
     * @default false
    */
    useConsoleAsOutput?: boolean;
}

export function createMemoryCompilerIoApi({
    sources,
    outputs,
    useConsoleAsOutput
}: Partial<MemoryCompilerIoApi> = {}): MemoryCompilerIoApi
{
    if( typeof useConsoleAsOutput !== "boolean" ) useConsoleAsOutput = false;
    if(!(sources instanceof Map)) sources = new Map();
    if(!(outputs instanceof Map)) outputs = new Map();
    const stderr = useConsoleAsOutput ? new ConsoleErrorStream() : new MemoryStream();
    return {
        stdout: useConsoleAsOutput ? new ConsoleLogStream() : new MemoryStream(),
        stderr,
        readFile: memoryFsRead.bind( sources ),
        writeFile: memoryFsWrite.bind( outputs ),
        exsistSync: exsistSync.bind( sources ),
        listFiles: memoryFsList.bind( sources ),
        reportDiagnostic: defaultReportDiagnostic.bind( stderr ),
        sources,
        outputs
    };
}

function defaultReportDiagnostic(this: MemoryStream, diagnostic: DiagnosticMessage): void
{
    this.write( diagnostic.toString() + "\n" );
}

function memoryFsAdaptFilename( filename: string ): string
{
    filename = getAbsolutePath( filename, "/" )!;
    if( typeof filename !== "string" ) return "";
    // filename = filename.replace( /\\/g, "/" );
    filename = filename.startsWith( "/" ) ? filename.slice( 1 ) : filename; 
    return filename;
}

function memoryFsRead(
    this: MemoryFs,
    filename: string
): string | undefined
{
    filename = memoryFsAdaptFilename( filename );
    while( filename.startsWith( "/" ) ) filename = filename.slice( 1 );
    const result = this.get( filename );
    return result instanceof Uint8Array ? toUtf8( result ) : undefined;
}

function memoryFsList(
    this: MemoryFs
): string[]
{
    return Array.from( this.keys() );
}

function memoryFsWrite(
    this: MemoryFs,
    filename: string,
    contents: Uint8Array | string
): void
{
    filename = memoryFsAdaptFilename( filename );
    if(!( contents instanceof Uint8Array ))
    {
        if( typeof contents === "string" ) {
            contents = fromUtf8( contents );
        }else if( typeof (contents as any).toString === "function" ) {
            contents = fromUtf8( (contents as any).toString() );
        } else {
            throw new Error("cannot write contents: invalid type");
        }
    }
    this.set( filename, contents );
}

function exsistSync(
    this: MemoryFs,
    filename: string
): boolean
{
    filename = memoryFsAdaptFilename( filename );
    return this.has( filename );
}
