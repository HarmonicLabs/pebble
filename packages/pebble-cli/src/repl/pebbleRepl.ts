import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import {
    Compiler,
    createMemoryCompilerIoApi,
    defaultOptions,
    fromUtf8,
    toHex,
    ConstTyTag,
    constTypeToStirng,
} from "@harmoniclabs/pebble";

function formatCEKValue(val: any): string
{
    if( val.tag === 5 /* CEKValueTag.Error */ )
    {
        return chalk.red("error") + (val.msg ? `: ${val.msg}` : "");
    }
    if( val.tag === 0 /* CEKValueTag.Const */ )
    {
        switch( val.typeTag )
        {
            case ConstTyTag.unit: return chalk.blue("void");
            case ConstTyTag.int: return chalk.yellow(val.value!.toString());
            case ConstTyTag.bool: return chalk.blue(val.value ? "true" : "false");
            case ConstTyTag.str: return chalk.green(`"${val.value}"`);
            case ConstTyTag.byteStr: return chalk.cyan(`#${toHex(val.value as Uint8Array)}`);
            case ConstTyTag.data: return `(data ${JSON.stringify(val.value)})`;
            case ConstTyTag.list:
            case ConstTyTag.pair:
            default:
                return `(${constTypeToStirng(val.type)} ${JSON.stringify(val.value, (_k: string, v: any) => typeof v === "bigint" ? v.toString() : v)})`;
        }
    }
    if( val.tag === 3 /* CEKValueTag.Constr */ )
    {
        const fields = val.values.map(formatCEKValue).join(", ");
        return `Constr ${val.index}${fields ? ` [${fields}]` : ""}`;
    }
    return "(lambda)";
}

export async function pebbleRepl(): Promise<void>
{
    const rl = readline.createInterface({ input: stdin, output: stdout });

    console.log(chalk.bold("Pebble REPL"));
    console.log("Type pebble expressions to evaluate them. Use :quit to exit.\n");

    const entryFile = "__repl__.pebble";

    while( true )
    {
        let input: string;
        try {
            input = await rl.question(chalk.blue("pebble> "));
        }
        catch {
            // EOF (ctrl+D)
            break;
        }

        const trimmed = input.trim();
        if( !trimmed ) continue;
        if( trimmed === ":quit" || trimmed === ":q" || trimmed === ":exit" )
        {
            break;
        }

        const ioApi = createMemoryCompilerIoApi({
            sources: new Map([
                [entryFile, fromUtf8(trimmed)],
            ]),
            useConsoleAsOutput: true,
        });

        const compiler = new Compiler(ioApi, {
            ...defaultOptions,
            silent: true,
        });

        try
        {
            const { result, budgetSpent, logs } = await compiler.runRepl({
                entry: entryFile,
                root: "/",
            });

            // print trace logs
            for( const log of logs )
            {
                console.log(chalk.magenta("trace:"), log);
            }

            // print result
            console.log(formatCEKValue(result));

            console.log(
                chalk.dim(`cpu: ${budgetSpent.cpu} | mem: ${budgetSpent.mem}`)
            );
        }
        catch( e: any )
        {
            const diagnostics = compiler.diagnostics;
            if( diagnostics.length > 0 )
            {
                for( const d of diagnostics )
                {
                    console.error(chalk.red(String(d)));
                }
            }
            else
            {
                console.error(chalk.red(e?.message ?? String(e)));
            }
        }
    }

    rl.close();
    console.log("\nBye!");
}
