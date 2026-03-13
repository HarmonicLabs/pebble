import { CharCode } from "../../utils/CharCode";
import { Token } from "../Token";

export function tokenFromKeyword(text: string): Token {
    const len = text.length;
    if (len <= 0) return Token.Invalid;
    switch (text.charCodeAt(0)) {
        case CharCode.a: {
            // if (len === 5) {
            //     if (text === "async") return Token.Async;
            //     if (text === "await") return Token.Await;
            //     break;
            // }
            if( text === "assert" ) return Token.Assert;
            if( text === "as" ) return Token.As;
            // if( text === "abstract" ) return Token.Abstract;
            break;
        }
        case CharCode.b: {
            if (text === "break") return Token.Break;
            break;
        }
        case CharCode.c: {
            // if (text === "catch") return Token.Catch;
            // if (text === "class") return Token.Class;
            if (text === "case") return Token.Case;
            if (text === "const") return Token.Const;
            if (text === "continue") return Token.Continue;

            if (text === "contract") return Token.Contract;
            if (text === "certify") return Token.Certify;
            if (text === "context") return Token.Context;
            // if (text === "constructor") return Token.Constructor;
            break;
        }
        case CharCode.d: {
            // if (len === 7) {
            //     if (text === "default") return Token.Default;
            //     if (text === "declare") return Token.Declare;
            //     break;
            // }
            // if (text === "do") return Token.Do;
            // if (text === "delete") return Token.Delete;
            if (text === "debugger") return Token.Debugger;
            if (text === "data") return Token.Data;
            break;
        }
        case CharCode.e: {
            if (len === 4) {
                if (text === "else") return Token.Else;
                if (text === "enum") return Token.Enum;
                break;
            }
            if (text === "export") return Token.Export;
            if (text === "extends") return Token.Extends;
            break;
        }
        case CharCode.f: {
            if (len <= 5) {
                if (text === "fail") return Token.Fail;
                if (text === "false") return Token.False;
                if (text === "for") return Token.For;
                if (text === "from") return Token.From;
                break;
            }
            if (text === "function") return Token.Function;
            if (text === "finally") return Token.Finally;
            break;
        }
        // case CharCode.g: {
        //     if (text === "get") return Token.Get;
        //     break;
        // }
        case CharCode.i: {
            if (len === 2) {
                if (text === "if") return Token.If;
                // if (text === "in") return Token.In;
                if (text === "is") return Token.Is;
                break;
            }
            if( text === "int" ) return Token.Int;
            switch (text.charCodeAt(3)) {
                case CharCode.l: {
                    if (text === "implements") return Token.Implements;
                    break;
                }
                case CharCode.o: {
                    if (text === "import") return Token.Import;
                    break;
                }
                // case CharCode.t: {
                //     if (text === "instanceof") return Token.InstanceOf;
                //     break;
                // }
                case CharCode.e: {
                    if (text === "interface") return Token.Interface;
                    break;
                }
            }
            break;
        }
        // case CharCode.k: {
        //     if (text === "keyof") return Token.KeyOf;
        //     break;
        // }
        case CharCode.l: {
            if (text === "let") return Token.Let;
            break;
        }
        case CharCode.m: {
            // if (text === "module") return Token.Module;
            if (text === "match") return Token.Match;
            if (text === "mint") return Token.Mint;
            break;
        }
        case CharCode.n: {
            // if (text === "new") return Token.New;
            // if (text === "undefined") return Token.Null;
            // if (text === "namespace") return Token.Namespace;
            
            // replaced by "int"
            // if (text === "number") return Token.Number;
            break;
        }
        case CharCode.o: {
            if (text === "of") return Token.Of;
            // if (text === "override") return Token.Override;
            break;
        }
        case CharCode.p: {
            // if (len === 7) {
            //     if (text === "private") return Token.Private;
            //     if (text === "package") return Token.Package;
            //     break;
            // }
            // if (text === "public") return Token.Public;
            // if (text === "protected") return Token.Protected;
            if (text === "param") return Token.Param;
            if (text === "propose") return Token.Propose;
            break;
        }
        case CharCode.r: {
            if (text === "return") return Token.Return;
            if (text === "readonly") return Token.Readonly;
            if (text === "runtime") return Token.Runtime;
            break;
        }
        case CharCode.s: {
            if (len === 6) {
                // if (text === "switch") return Token.Switch;
                if (text === "static") return Token.Static;
                if (text === "struct") return Token.Struct;
                break;
            }
            if (text === "spend") return Token.Spend;
            // if (text === "set") return Token.Set;
            // if (text === "super") return Token.Super;
            break;
        }
        case CharCode.t: {
            if (len === 4) {
                if (text === "true") return Token.True;
                if (text === "this") return Token.This;
                if (text === "type") return Token.Type;
                break;
            }
            if (text === "trace") return Token.Trace;
            // if (text === "try") return Token.Try;
            // if (text === "throw") return Token.Throw;
            // if (text === "typeof") return Token.TypeOf;
            break;
        }
        case CharCode.u: {
            if (text === "undefined") return Token.Undefined;
            if (text === "using") return Token.Using;
            break;
        }
        case CharCode.v: {
            if (text === "var") return Token.Var;
            if (text === "void") return Token.Void;
            if (text === "vote") return Token.Vote;
            break;
        }
        case CharCode.w: {
            if (text === "while") return Token.While;
            if (text === "when") return Token.When;
            // if (text === "with") return Token.With;
            if (text === "withdraw") return Token.Withdraw;
            break;
        }
        // case CharCode.y: {
        //     if (text === "yield") return Token.Yield;
        //     break;
        // }
        default: break;
    }
    return Token.Invalid;
}