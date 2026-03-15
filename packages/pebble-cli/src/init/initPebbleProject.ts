/// @ts-ignore Cannot find module '@inquirer/prompts' or its corresponding type declarations.
import { input, confirm, select, Separator } from "@inquirer/prompts";
import chalk from "chalk";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";

interface OffchainConfig
{
    network: "mainnet" | "preprod" | "preview";
    provider: "blockfrost" | "koios" | "kupmios" | "local-node" | "utxo-rpc" | "maestro";
}

export async function initPebbleProject(): Promise<void>
{
    const projectName = await input({
        required: true,
        message: "What is the name of your project?",
        default: "my-pebble-project",
    });

    const includeClaudeMd = await confirm({
        message: "Do you want to include a CLAUDE.md file? (helps AI assistants understand Pebble)",
        default: true
    });

    let offchain: OffchainConfig | undefined = undefined;
    const includeOffchain = /*
    await confirm({
        message: "Do you want to include offchain code using buildooor?",
        default: false
    });
    /*/
    false;
    //*/

    if( includeOffchain )
    {
        const network = await select({
            message: "Which network would you like to target?",
            default: "preprod",

            choices: [
                {
                    name: "mainnet",
                    value: "mainnet",
                    description: "Cardano mainnet (transactions cost real ADA)."
                },
                {
                    name: "preprod",
                    value: "preprod",
                    description: "pre-production testnet, closest to mainnet."
                },
                {
                    name: "preview",
                    value: "preview",
                    description: "preview testnet, for quick prototyping."
                },
            ]
        });

        const provider = await select({
            message: "Which provider would you like to use?",
            default: "blockfrost",
            choices: [
                {
                    name: "Blockfrost",
                    value: "blockfrost",
                    description: "Blockfrost is a popular Cardano API provider."
                },
                {
                    name: "Koios",
                    value: "koios",
                    description: "Koios is a community-driven Cardano API provider."
                },
                {
                    name: "Kupo + Ogmios (Kupmios)",
                    value: "kupmios",
                    description: "Use Kupo + Ogmios to index the chain yourself.",
                },
                new Separator(),
                {
                    name: "Local node",
                    value: "local-node",
                    description: "Connect to a local node using a unix socket.",
                    disabled: "(coming soon)"
                },
                {
                    name: "UTxO RPC",
                    value: "utxo-rpc",
                    description: "Connect to a UTxO RPC server.",
                    disabled: "(coming soon)"
                },
                {
                    name: "Maestro",
                    value: "maestro",
                    description: "Maestro is a managed Cardano API provider.",
                    disabled: "(coming soon)"
                }
            ]
        });

        offchain = { network: network as any, provider: provider as any };
    }

    // paths
    const projectRoot = path.resolve(process.cwd(), projectName);
    const srcDir = path.join(projectRoot, "src");
    const offchainDir = path.join(projectRoot, "offchain");

    // check existing directory state
    let shouldProceed = true;
    if( existsSync(projectRoot) ) {
        let shouldProceed = false;
        try {
            const entries = await fs.readdir(projectRoot);
            if (entries.length > 0) {
                shouldProceed = await confirm({
                    message: `Directory "${projectName}" already exists and is not empty. Continue and overwrite conflicting files?`,
                    default: false
                });
            }
        } catch { /* ignore */ }
    }

    if (!shouldProceed) {
        console.log(chalk.yellow("Aborted. No files were created."));
        return;
    }

    // ensure directories
    await fs.mkdir(srcDir, { recursive: true });
    if (includeOffchain) {
        await fs.mkdir(offchainDir, { recursive: true });
    }

    // write helpers
    async function writeFile(filePath: string, content: string) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, { encoding: "utf8" });
    }

    // .gitignore
    const gitignorePath = path.join(projectRoot, ".gitignore");
    const gitignore = [
        "node_modules/",
        "dist/",
        "out/",
        ".env",
        ".DS_Store"
    ].join("\n");
    await writeFile(gitignorePath, gitignore + "\n");

    // README
    const readmePath = path.join(projectRoot, "README.md");
    const readme = `# ${projectName}

This is a starter project for a Pebble smart contract.

Getting started:

- Edit your contract in \`src/index.pebble\`.
- Compile using the Pebble CLI (once \`pebble compile\` is implemented) or your tooling.

Structure:

- \`src/index.pebble\`: entry script
- \`pebble.config.json\`: compiler options
${includeOffchain ? "- `offchain/`: optional offchain scaffolding\n" : ""}
`;
    await writeFile(readmePath, readme);

    // pebble config
    const configPath = path.join(projectRoot, "pebble.config.json");
    const pebbleConfig = {
        entry: "./src/index.pebble",
        outDir: "./out",
        removeTraces: true,
    } as const;
    await writeFile(configPath, JSON.stringify(pebbleConfig, null, 2) + "\n");

    // package.json (optional helper scripts)
    const pkgPath = path.join(projectRoot, "package.json");
    const pkgJson = {
        name: projectName,
        private: true,
        type: "module",
        scripts: {
            // placeholders until compile subcommand is wired
            "compile": "pebble compile --config ./pebble.config.json"
        }
    } as const;
    await writeFile(pkgPath, JSON.stringify(pkgJson, null, 2) + "\n");

    // src/index.pebble template
    const indexPebblePath = path.join(srcDir, "index.pebble");
    const indexPebble = (
`// if no methods are defined
// the contract is interpreted as always failing
contract MyContract {

    param owner: PubKeyHash;

    spend ownerAllowsIt() {
        const { tx } = context;

        assert tx.requiredSigners.includes( this.owner );
    }

    spend sendToOwner( amount: int ) {
        const { tx } = context;

        assert tx.outputs.length() === 1;

        const output = tx.outputs[0];

        assert output.address.payment.hash() == this.owner;
        assert output.value.lovelaces() >= amount;
    }

    // mint mintOrBurnTokens() {}
    
    // cert validateCertificateSubmission() {}

    // withdraw getStakingRewards() {}

    // vote voteOnProposal() {}

    // propose proposeGovernanceAction () {}
}`
    );
    await writeFile(indexPebblePath, indexPebble);

    // CLAUDE.md
    if( includeClaudeMd )
    {
    const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
    const claudeMd = (
`# Pebble Project

This is a Pebble smart contract project. Pebble is a language with JavaScript-like syntax that compiles to UPLC for Cardano smart contracts.

## Project structure

- \`src/index.pebble\` - main contract entry point
- \`pebble.config.json\` - compiler config (entry, outDir, removeTraces)
- \`out/\` - compiled output (generated)
${includeOffchain ? "- \\`offchain/\\` - offchain code using buildooor\n" : ""}\
## CLI commands

- \`pebble compile --config ./pebble.config.json\` - compile the project
- \`pebble export --function-name <name>\` - export a single function
- \`npm run compile\` - shortcut for compile

## Pebble language reference

### Contracts

\`\`\`pebble
contract ContractName {
    param owner: PubKeyHash;

    spend methodName(arg: int) {
        const { tx } = context;
        assert tx.requiredSigners.includes(this.owner);
    }
}
\`\`\`

A contract with no methods is an always-failing validator.

### Method types

\`spend\`, \`mint\`, \`cert\`, \`withdraw\`, \`vote\`, \`propose\`

### Context

Inside contract methods, \`context\` provides:
- \`tx\` - the transaction (always available)
- \`spendingInputRef\` - reference to the UTxO being spent (\`spend\` methods)
- \`optionalDatum\` - optional datum on the spent UTxO (\`spend\` methods)

### Tx fields

\`tx.inputs\`, \`tx.refInputs\`, \`tx.outputs\`, \`tx.fee\`, \`tx.mint\`,
\`tx.certificates\`, \`tx.withdrawals\`, \`tx.validityInterval\`,
\`tx.requiredSigners\`, \`tx.redeemers\`, \`tx.datums\`, \`tx.hash\`,
\`tx.votes\`, \`tx.proposals\`, \`tx.currentTreasury\`, \`tx.treasuryDonation\`

### Structs

\`\`\`pebble
struct Order {
    ownerPaymentCreds: PubKeyHash,
    policy: bytes,
    minAmount: int
}
\`\`\`

Sum types (data structs):

\`\`\`pebble
struct OutputDatum {
    NoDatum {}
    DatumHash { hash: Hash32 }
    InlineDatum { datum: data }
}
\`\`\`

### Built-in types

\`int\`, \`bytes\`, \`bool\`, \`data\`,
\`PubKeyHash\`, \`ScriptHash\`, \`Hash32\`, \`Hash28\`,
\`PolicyId\`, \`TokenName\`, \`TxHash\`,
\`Credential\`, \`Address\`, \`Value\`, \`TxOut\`, \`TxIn\`, \`TxOutRef\`,
\`List<T>\`, \`Optional<T>\`, \`LinearMap<K,V>\`, \`Interval\`

### Variables and control flow

- \`const x = value;\` / \`let x = value;\`
- \`if/else\`, ternary \`? :\`
- \`for(const x of list)\`, \`for(let i = 0; i < n; i++)\`
- \`assert condition;\` - fails the contract if false
- \`trace value;\` - debug output
- \`fail;\` - explicitly fail

### Pattern matching

\`\`\`pebble
assert case ownerCreds
    is PubKeyHash{ hash } => tx.signatories.includes(hash)
    is Validator{ hash } => tx.inputs.some(input => input.resolved.address.payment.hash() === hash);
\`\`\`

### Datum extraction

\`\`\`pebble
const InlineDatum{ datum: { field1, field2 } as MyStruct } = someOutput.datum;
\`\`\`

### Common operations

- \`list.includes(item)\`, \`list.filter(fn)\`, \`list.find(fn)\`, \`list.some(fn)\`
- \`list.head()\`, \`list.tail()\`, \`list.isEmpty()\`, \`list.length()\`
- \`value.lovelaces()\`, \`value.amountOf(policy, tokenName)\`
- \`credential.hash()\`
- Hex literals: \`#aabbcc\`
- Numeric separators: \`5_000_000\`
- Access contract params with \`this.paramName\`
`
    );
    await writeFile(claudeMdPath, claudeMd);
    }

    // optional offchain scaffolding
    if (includeOffchain && offchain) {
        const offchainReadme = `# Offchain

This folder is intended for offchain code (e.g., using Buildooor).

Selected network: ${offchain.network}
Selected provider: ${offchain.provider}

Configure environment by copying \`.env.example\` to \`.env\` and filling values.
`;
        await writeFile(path.join(offchainDir, "README.md"), offchainReadme);

        const envLines: string[] = [];
        envLines.push(`# Environment variables for ${offchain.provider} on ${offchain.network}`);
        if (offchain.provider === "blockfrost") {
            envLines.push(`BLOCKFROST_API_KEY="your_blockfrost_api_key"`);
        } else if (offchain.provider === "koios") {
            envLines.push("KOIOS_URL=https://api.koios.rest/api/v1/");
        } else if (offchain.provider === "kupmios") {
            envLines.push("OGMIOS_URL=ws://localhost:1337");
            envLines.push("KUPO_URL=http://localhost:1442");
        }
        await writeFile(path.join(projectRoot, ".env"), envLines.join("\n") + "\n");
    }

    console.log();
    console.log(chalk.green("Pebble project initialized!"));
    console.log(chalk.gray(projectRoot));
    console.log();
    console.log(chalk.green("Next steps:"));
    console.log(`  1. cd ${chalk.cyan(projectName)}`);
    console.log("  2. Open src/index.pebble and start coding.");
    if (includeOffchain) {
        console.log("  3. Fill values for your provider in the .env file.");
    }
}