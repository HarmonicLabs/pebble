import { Identifier } from "../../../../ast/nodes/common/Identifier";
import { ContractDecl } from "../../../../ast/nodes/statements/declarations/ContractDecl";
import { FuncDecl } from "../../../../ast/nodes/statements/declarations/FuncDecl";
import { StateDecl } from "../../../../ast/nodes/statements/declarations/StateDecl";
import { StructConstrDecl, StructDecl, StructDeclAstFlags } from "../../../../ast/nodes/statements/declarations/StructDecl";
import { SimpleVarDecl } from "../../../../ast/nodes/statements/declarations/VarDecl/SimpleVarDecl";
import { SourceRange } from "../../../../ast/Source/SourceRange";
import { DiagnosticCode } from "../../../../diagnostics/diagnosticMessages.generated";
import { getUniqueInternalName } from "../../../internalVar";
import type { AstCompiler } from "../../AstCompiler";

/**
 * Type-level symbols synthesized from a `ContractDecl`'s SIGNATURES only
 * (no method bodies are read): the state-datum union, the merged
 * direct-methods redeemer union, and per-state spend redeemer unions.
 *
 * Derived once per `ContractDecl` (cached on the `AstCompiler`); both the
 * exported-contract registration pass and the entry-contract body
 * derivation consume the SAME instance — re-deriving would mint new
 * unique names and collide on the datum union's `defineType`.
 */
export interface DerivedContractTypes {
    /** StructDecl named EXACTLY the contract name; `undefined` if the contract has no states */
    datumTypeDef: StructDecl | undefined;
    /**
     * merged union of ALL direct methods across purposes, constructor
     * order: spend, mint, withdraw, certify, propose, vote (declaration
     * order within each purpose); `undefined` if there are none.
     *
     * single-purpose contracts get the same constructor list and
     * `shortcutSingleConstructor` behavior as the pre-0.3.7 per-purpose
     * unions, so their on-chain encoding is unchanged.
     */
    directRedeemerTypeDef: StructDecl | undefined;
    /** state name -> that state's spend redeemer union (only states with >=1 spend method) */
    stateRedeemerTypeDefs: Map<string, StructDecl>;
    /** all state names, including spend-less ones (for diagnostics) */
    stateNames: string[];

    // TIR type keys, filled by `AstCompiler.getOrDeriveContractTypes`
    // after registration
    datumTirName?: string | undefined;
    directRedeemerTirName?: string | undefined;
    stateRedeemerTirNames: Map<string, string>;
}

/**
 * All direct (non-state) methods in the merged-union constructor order.
 *
 * This order IS the encoding-compatibility rule: it mirrors the purpose
 * processing order of `_deriveContractBody`, so a contract whose direct
 * methods live under a single purpose keeps identical constructor tags.
 */
export function directMethodsInOrder( contractDecl: ContractDecl ): FuncDecl[]
{
    return [
        ...contractDecl.spendMethods,
        ...contractDecl.mintMethods,
        ...contractDecl.withdrawMethods,
        ...contractDecl.certifyMethods,
        ...contractDecl.proposeMethods,
        ...contractDecl.voteMethods,
    ];
}

/**
 * @returns `undefined` on validation error (already reported on `compiler`)
 */
export function deriveContractTypes(
    compiler: AstCompiler,
    contractDecl: ContractDecl
): DerivedContractTypes | undefined
{
    const contractName = contractDecl.name.text;
    const contractRange = contractDecl.range;

    const directMethods = directMethodsInOrder( contractDecl );

    // direct method names must be unique ACROSS ALL PURPOSES:
    // they share one merged redeemer union (one constructor each)
    const seenDirectNames = new Set<string>();
    let valid = true;
    for( const m of directMethods )
    {
        const name = m.expr.name.text;
        if( seenDirectNames.has( name ) )
        {
            compiler.error(
                DiagnosticCode.Duplicate_method_name_0_in_contract_1_method_names_must_be_unique_across_all_purposes,
                m.expr.name.range, name, contractName
            );
            valid = false;
            continue;
        }
        seenDirectNames.add( name );
    }

    // state spend-method names only need to be unique WITHIN their state:
    // each state has its own redeemer union (separate tag space, separate
    // dispatch site), so collisions with direct methods or other states'
    // methods are never ambiguous.
    for( const stateDecl of contractDecl.stateDecls )
    {
        const seenStateNames = new Set<string>();
        for( const m of stateDecl.spendMethods )
        {
            const name = m.expr.name.text;
            if( seenStateNames.has( name ) )
            {
                compiler.error(
                    DiagnosticCode.Duplicate_method_name_0_in_contract_1_method_names_must_be_unique_across_all_purposes,
                    m.expr.name.range, name, `${contractName}.${stateDecl.name.text}`
                );
                valid = false;
                continue;
            }
            seenStateNames.add( name );
        }
    }

    if( !valid ) return undefined;

    const datumTypeDef = contractDecl.stateDecls.length > 0
        ? _deriveContractDatumTypeDef( contractName, contractDecl.stateDecls, contractRange )
        : undefined;

    const directRedeemerTypeDef = directMethods.length > 0
        ? _deriveRedeemerTypeDef( "DirectRedeemer", directMethods, contractRange )
        : undefined;

    const stateRedeemerTypeDefs = new Map<string, StructDecl>();
    for( const stateDecl of contractDecl.stateDecls )
    {
        if( stateDecl.spendMethods.length === 0 ) continue;
        stateRedeemerTypeDefs.set(
            stateDecl.name.text,
            _deriveRedeemerTypeDef(
                `${stateDecl.name.text}Redeemer`,
                stateDecl.spendMethods,
                stateDecl.range
            )
        );
    }

    return {
        datumTypeDef,
        directRedeemerTypeDef,
        stateRedeemerTypeDefs,
        stateNames: contractDecl.stateDecls.map( s => s.name.text ),
        stateRedeemerTirNames: new Map(),
    };
}

export function _deriveContractDatumTypeDef(
    contractName: string,
    stateDecls: readonly StateDecl[],
    contractRange: SourceRange,
): StructDecl
{
    let defFlags = StructDeclAstFlags.onlyDataEncoding;
    if( stateDecls.length <= 1 ) defFlags |= StructDeclAstFlags.shortcutSingleConstructor;

    return new StructDecl(
        new Identifier( contractName, contractRange ),
        [], // typeParams
        stateDecls.map( s =>
            new StructConstrDecl(
                new Identifier( s.name.text, s.name.range ),
                s.fields,
                s.range
            )
        ),
        defFlags,
        contractRange
    );
}

export function _deriveRedeemerTypeDef(
    redeemerName: string,
    methods: FuncDecl[],
    contractRange: SourceRange,
): StructDecl
{
    let defFlags = StructDeclAstFlags.onlyDataEncoding;
    if( methods.length <= 1 ) defFlags |= StructDeclAstFlags.shortcutSingleConstructor;

    const uniqueName = getUniqueInternalName( redeemerName );
    return new StructDecl(
        new Identifier( uniqueName, SourceRange.mock ),
        [], // typeParams
        methods.map( m => {
            const methodParams = m.expr.signature.params;
            if(!methodParams.every( p =>
                p instanceof SimpleVarDecl && !p.initExpr && p.type
            )) throw new Error("Contract method parameters not simplified befor inferring redeemer definition.");

            return new StructConstrDecl(
                new Identifier( m.expr.name.text, m.expr.name.range ),
                methodParams as SimpleVarDecl[],
                contractRange
            );
        }), // contructors
        defFlags,
        contractRange
    );
}
