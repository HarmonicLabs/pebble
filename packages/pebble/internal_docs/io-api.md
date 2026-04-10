# IO API

The compiler IO layer (`src/compiler/io/`) abstracts all file system and output stream operations behind interfaces. This decouples the compilation pipeline from the host environment, enabling filesystem-based compilation, in-memory compilation (tests, REPL, browser), and custom IO backends.

## CompilerIoApi Interface

**File:** `src/compiler/io/CompilerIoApi.ts`

```typescript
interface CompilerIoApi {
    stdout: IOutputStream;
    readonly stderr: IOutputStream;
    readFile: (filename: string, baseDir: string) => MaybePromise<string | undefined>;
    writeFile: (filename: string, contents: Uint8Array | string, baseDir: string) => MaybePromise<void>;
    exsistSync: (filename: string) => boolean;
    listFiles: (dirname: string, baseDir: string) => MaybePromise<string[] | undefined>;
    reportDiagnostic: (diagnostic: DiagnosticMessage) => void;
}
```

### Methods

| Method | Purpose |
|--------|---------|
| `stdout` | Writable stream for compiler output (progress messages, results) |
| `stderr` | Writable stream for error output |
| `readFile(filename, baseDir)` | Reads a source file. Returns `undefined` if not found. Supports async. |
| `writeFile(filename, contents, baseDir)` | Writes compiled output (UPLC binary or text). Supports async. |
| `exsistSync(filename)` | Synchronous file existence check. Used for module resolution. |
| `listFiles(dirname, baseDir)` | Lists files in a directory. Used for wildcard imports. Returns `undefined` if directory not found. |
| `reportDiagnostic(diagnostic)` | Handler for compiler diagnostics (errors, warnings, info). Typically writes to `stderr`. |

### MaybePromise

`readFile`, `writeFile`, and `listFiles` return `MaybePromise<T>`, allowing implementations to be either synchronous or asynchronous. The compiler `await`s these calls, so both modes work transparently.

## IOutputStream Interface

**File:** `src/compiler/io/IOutputStream.ts`

```typescript
interface IOutputStream {
    write(chunk: Uint8Array | string): void;
}
```

Minimal writable stream interface. Three implementations are provided:

### ConsoleLogStream
Routes output to `console.log()`. Buffers incomplete lines and flushes on newline characters. Handles both `Uint8Array` and `string` input.

### ConsoleErrorStream
Routes output to `console.error()`. Converts `Uint8Array` to UTF-8 strings before output.

### MemoryStream
Accumulates output in memory as `Uint8Array` chunks. Provides:
- `reset()` — clears the buffer
- `toBuffer(): Uint8Array` — returns concatenated output
- `toString(): string` — returns UTF-8 decoded output

## MemoryCompilerIoApi

**File:** `src/compiler/io/CompilerIoApi.ts`

The default in-memory implementation, created via `createMemoryCompilerIoApi()`:

```typescript
interface MemoryCompilerIoApi extends CompilerIoApi {
    sources: MemoryFs;          // Map<string, Uint8Array> for input files
    outputs: MemoryFs;          // Map<string, Uint8Array> for output files
    useConsoleAsOutput?: boolean; // Route stdout/stderr to console (default: false)
}
```

### File Path Normalization

`memoryFsAdaptFilename()` normalizes paths before Map lookups:
1. Converts to absolute paths via `getAbsolutePath()`
2. Strips leading slashes
3. Handles directory traversal (`../`)

### Factory Function

```typescript
function createMemoryCompilerIoApi({
    sources,
    outputs,
    useConsoleAsOutput
}: Partial<MemoryCompilerIoApi> = {}): MemoryCompilerIoApi
```

- `sources` defaults to an empty `Map`
- `outputs` defaults to an empty `Map`
- When `useConsoleAsOutput = false` (default): both `stdout` and `stderr` are `MemoryStream` instances
- When `useConsoleAsOutput = true`: `stdout` uses `ConsoleLogStream`, `stderr` uses `ConsoleErrorStream`

### Internal Helpers

| Function | Purpose |
|----------|---------|
| `memoryFsRead(map, filename, baseDir)` | Reads from `sources` Map, decodes `Uint8Array` to UTF-8 |
| `memoryFsList(map, dirname, baseDir)` | Returns all keys from the Map (ignores `dirname`) |
| `memoryFsWrite(map, filename, contents, baseDir)` | Writes to `outputs` Map, encodes strings to `Uint8Array` |
| `defaultReportDiagnostic(stderr, diag)` | Formats diagnostic and writes to `stderr` |

## Usage in the Compiler

### Compiler Constructor

```typescript
class Compiler {
    constructor(
        readonly io: CompilerIoApi = createMemoryCompilerIoApi({ useConsoleAsOutput: true }),
        readonly cfg: CompilerOptions = defaultOptions,
        diagnostics?: DiagnosticMessage[]
    )
}
```

The default `Compiler` uses memory IO with console output. When `cfg.silent === true`, `stdout` is replaced with a no-op stream.

### Flow Through the Pipeline

1. **Source Loading** — `AstCompiler` calls `io.readFile()` to load entry and imported source files
2. **Module Resolution** — `io.exsistSync()` checks candidate paths during import resolution
3. **Directory Scanning** — `io.listFiles()` supports wildcard or directory imports
4. **Progress Output** — compilation stages write status messages to `io.stdout`
5. **Diagnostic Reporting** — type errors, parse errors, and warnings go through `io.reportDiagnostic()`
6. **Output Writing** — compiled UPLC binary is written via `io.writeFile()` to the configured `outDir`

### Custom IO Backends

To run the compiler in a non-Node.js environment (browser, WASM, testing harness), implement `CompilerIoApi` with appropriate backing stores. The `MemoryCompilerIoApi` serves as a reference implementation and is used directly in tests.
