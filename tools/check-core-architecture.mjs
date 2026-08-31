// Architecture gate for src/core/** — an allow-list over symbol provenance.
//
// Model: every value-position identifier in the core must resolve, through the
// TypeScript checker, either to a declaration inside src/core/** or to one of
// the reviewed ECMAScript standard-library names below. Anything that resolves
// to nothing (Node globals such as `process`, `global`, `require`, timers), to
// a non-core, non-standard declaration, or to an unlisted standard name
// (`Date`, `Function`, `eval`, `globalThis`, `Intl`, `Reflect`, `Proxy`,
// `Promise`, ...) fails closed. Reflective escapes are rejected structurally:
// `constructor` / `prototype` / `__proto__` members, prototype and descriptor
// APIs, computed member access on `any`/function-typed operands, calls through
// computed members, `declare` (except unique-symbol brands), async code,
// dynamic import, import.meta, module-scope mutable state, classes, and any
// module specifier that leaves src/core. Every file under src/core must be a
// `.ts` file so nothing escapes the program.
//
// Declared limit (see DECISIONS.md): the gate proves that the declared core
// references only core code and a reviewed standard-library subset; it does
// not prove that the declared boundary sits at the right place — that is the
// job of the Core/shell-mixing lens.

import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const CORE_ROOT = path.resolve("src/core");

const ALLOWED_LIB_VALUES = new Set([
  "Array", "ArrayBuffer", "BigInt", "BigInt64Array", "BigUint64Array", "Boolean", "DataView",
  "Error", "EvalError", "Float32Array", "Float64Array", "Infinity", "Int8Array", "Int16Array", "Int32Array",
  "JSON", "Map", "Math", "NaN", "Number", "Object", "RangeError", "ReferenceError", "Set", "String", "Symbol",
  "SyntaxError", "TypeError", "URIError", "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array",
  "WeakMap", "WeakSet", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
  "isFinite", "isNaN", "parseFloat", "parseInt", "undefined",
]);

const FORBIDDEN_LIB_MEMBERS = new Set([
  "Math.random",
  "Symbol.for", "Symbol.keyFor",
  "Object.getPrototypeOf", "Object.setPrototypeOf", "Object.getOwnPropertyDescriptor",
  "Object.getOwnPropertyDescriptors", "Object.defineProperty", "Object.defineProperties",
]);

const FORBIDDEN_MEMBER_NAMES = new Set(["constructor", "__proto__", "prototype", "caller", "callee", "arguments"]);

function compilerOptions() {
  return {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2024.d.ts"],
    types: [],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    verbatimModuleSyntax: true,
  };
}

function listCoreFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listCoreFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}

function isInside(root, fileName) {
  const resolved = path.resolve(fileName);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function isPartOfType(node) {
  for (let current = node.parent; current !== undefined && !ts.isSourceFile(current); current = current.parent) {
    if (ts.isTypeNode(current) || ts.isTypeAliasDeclaration(current) || ts.isInterfaceDeclaration(current)) return true;
  }
  return false;
}

export function inspectCoreDirectory(coreRoot) {
  const root = path.resolve(coreRoot);
  const files = listCoreFiles(root);
  const violations = [];
  const report = (fileName, message) => violations.push(`${path.relative(process.cwd(), fileName)}: ${message}`);

  const sourceFiles = [];
  for (const fileName of files) {
    if (fileName.endsWith(".ts") && !fileName.endsWith(".d.ts")) sourceFiles.push(fileName);
    else report(fileName, "only .ts source files may live in the core");
  }

  const program = ts.createProgram(sourceFiles, compilerOptions());
  const checker = program.getTypeChecker();

  function symbolProvenance(symbol) {
    let resolved = symbol;
    if ((resolved.flags & ts.SymbolFlags.Alias) !== 0) resolved = checker.getAliasedSymbol(resolved);
    const declarations = resolved.declarations ?? [];
    if (declarations.length === 0) return { kind: "unresolved", symbol: resolved };
    const inCore = declarations.every(declaration => isInside(root, declaration.getSourceFile().fileName));
    if (inCore) return { kind: "core", symbol: resolved };
    const inLib = declarations.every(declaration => program.isSourceFileDefaultLibrary(declaration.getSourceFile()));
    return { kind: inLib ? "lib" : "foreign", symbol: resolved };
  }

  function checkLibSymbol(fileName, symbol, spelled) {
    const isGlobal = symbol.parent === undefined || (symbol.parent.flags & ts.SymbolFlags.Module) !== 0 && symbol.parent.escapedName === "__global";
    const fullName = checker.getFullyQualifiedName(symbol).replace(/^"[^"]*"\./u, "").replace(/Constructor\./u, ".");
    const spelledName = spelled.replace(/\[['"]([^'"]+)['"]\]/u, ".$1");
    if (FORBIDDEN_MEMBER_NAMES.has(symbol.name)) report(fileName, `forbidden reflective member '${spelled}'`);
    else if (FORBIDDEN_LIB_MEMBERS.has(fullName) || FORBIDDEN_LIB_MEMBERS.has(spelledName)) report(fileName, `forbidden standard-library member '${FORBIDDEN_LIB_MEMBERS.has(fullName) ? fullName : spelledName}'`);
    else if (isGlobal && !ALLOWED_LIB_VALUES.has(symbol.name)) report(fileName, `standard-library value '${symbol.name}' is not on the core allow-list`);
  }

  function inspectValueReference(fileName, node, spelled) {
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol === undefined) {
      report(fileName, `unresolved identifier '${spelled}' (not core code, not standard library)`);
      return;
    }
    const provenance = symbolProvenance(symbol);
    if (provenance.kind === "core") {
      if (FORBIDDEN_MEMBER_NAMES.has(provenance.symbol.name) && ts.isPropertyAccessExpression(node.parent)) report(fileName, `forbidden reflective member '${spelled}'`);
      return;
    }
    if (provenance.kind === "lib") { checkLibSymbol(fileName, provenance.symbol, spelled); return; }
    if (provenance.kind === "unresolved") { report(fileName, `unresolved identifier '${spelled}'`); return; }
    report(fileName, `identifier '${spelled}' resolves outside the core and the standard library`);
  }

  function isAnyOrCallable(type) {
    if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
    if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return true;
    if ((type.flags & ts.TypeFlags.Object) !== 0 && checker.typeToString(type) === "Object") return true;
    return type.isUnion() ? type.types.some(isAnyOrCallable) : false;
  }

  function inspectSourceFile(sourceFile) {
    const fileName = sourceFile.fileName;

    function inspectModuleSpecifier(moduleSpecifier, kind) {
      if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier)) return;
      const specifier = moduleSpecifier.text;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) { report(fileName, `external or platform ${kind} '${specifier}'`); return; }
      const importedPath = path.resolve(path.dirname(fileName), specifier);
      if (!isInside(root, importedPath)) report(fileName, `relative ${kind} escapes src/core '${specifier}'`);
    }

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) inspectModuleSpecifier(statement.moduleSpecifier, "import");
      if (ts.isExportDeclaration(statement)) inspectModuleSpecifier(statement.moduleSpecifier, "re-export");
      if (ts.isImportEqualsDeclaration(statement)) report(fileName, "import-equals is forbidden in the core");
      if (ts.isModuleDeclaration(statement)) report(fileName, "namespace, module, or global augmentation is forbidden in the core");
      if (ts.isClassDeclaration(statement)) report(fileName, "module-scope class may carry mutable static state");
      if (ts.isVariableStatement(statement)) {
        const isDeclare = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
        const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
        if (!isConst) report(fileName, "module-scope let/var is mutable global state");
        for (const declaration of statement.declarationList.declarations) {
          if (isDeclare) {
            const isUniqueSymbolBrand = declaration.initializer === undefined && declaration.type !== undefined
              && ts.isTypeOperatorNode(declaration.type) && declaration.type.operator === ts.SyntaxKind.UniqueKeyword;
            if (!isUniqueSymbolBrand) report(fileName, "ambient declaration is forbidden in the core (only `declare const x: unique symbol` brands)");
          } else if (declaration.initializer !== undefined && !isPrimitiveConstant(declaration.initializer)) {
            report(fileName, "module-scope non-primitive state is forbidden");
          }
        }
      }
    }

    function visit(node) {
      if (ts.isFunctionLike(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) report(fileName, "async code is forbidden in the core");
      if (ts.isAwaitExpression(node)) report(fileName, "await is forbidden in the core");
      if (ts.isMetaProperty(node)) report(fileName, "import.meta / new.target is forbidden in the core");
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) report(fileName, "dynamic import is forbidden in the core");
      if (ts.isClassExpression(node)) report(fileName, "class expressions are forbidden in the core");
      if (node.kind === ts.SyntaxKind.AnyKeyword) report(fileName, "explicit 'any' is forbidden in the core");
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const sourceType = checker.getTypeAtLocation(node.expression);
        if (sourceType.getCallSignatures().length > 0 || sourceType.getConstructSignatures().length > 0) report(fileName, `type assertion hides a callable value '${node.getText(sourceFile)}'`);
      }
      if (ts.isPropertyAccessExpression(node) && !isPartOfType(node)) {
        if (FORBIDDEN_MEMBER_NAMES.has(node.name.text)) report(fileName, `forbidden reflective member '${node.getText(sourceFile)}'`);
      }
      if (ts.isElementAccessExpression(node) && !isPartOfType(node)) {
        const argument = node.argumentExpression;
        if (ts.isStringLiteralLike(argument)) {
          if (FORBIDDEN_MEMBER_NAMES.has(argument.text)) report(fileName, `forbidden reflective member '${node.getText(sourceFile)}'`);
          const symbol = checker.getSymbolAtLocation(argument);
          if (symbol !== undefined) {
            const provenance = symbolProvenance(symbol);
            if (provenance.kind === "lib") checkLibSymbol(fileName, provenance.symbol, node.getText(sourceFile));
          }
        } else {
          const operandType = checker.getTypeAtLocation(node.expression);
          if (isAnyOrCallable(operandType)) report(fileName, `computed member access on an untyped or callable operand '${node.getText(sourceFile)}'`);
        }
      }
      if ((ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node))) {
        const callee = ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
        if (ts.isElementAccessExpression(callee) && !ts.isStringLiteralLike(callee.argumentExpression)) report(fileName, `call through a computed member '${callee.getText(sourceFile)}'`);
      }
      if (ts.isIdentifier(node) && !isPartOfType(node)) {
        const parent = node.parent;
        const isDeclarationName = "name" in parent && parent.name === node && !ts.isPropertyAccessExpression(parent);
        const isPropertyName = (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isShorthandPropertyAssignment(parent) && parent.name === node)
          || (ts.isPropertySignature(parent) && parent.name === node)
          || (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent))
          || ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)
          || (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || (ts.isQualifiedName(parent) && parent.right === node);
        if (!isDeclarationName && !isPropertyName && node.text !== "undefined") inspectValueReference(fileName, node, node.text);
        if (ts.isPropertyAccessExpression(parent) && parent.name === node && !isPartOfType(parent)) {
          const symbol = checker.getSymbolAtLocation(node);
          if (symbol !== undefined) {
            const provenance = symbolProvenance(symbol);
            if (provenance.kind === "lib") checkLibSymbol(fileName, provenance.symbol, parent.getText(sourceFile));
            else if (provenance.kind === "foreign") report(fileName, `member '${parent.getText(sourceFile)}' resolves outside the core and the standard library`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (isInside(root, sourceFile.fileName)) inspectSourceFile(sourceFile);
  }
  return [...new Set(violations)];
}

function isPrimitiveConstant(node) {
  return ts.isStringLiteral(node)
    || ts.isNumericLiteral(node)
    || ts.isBigIntLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword
    || (ts.isPrefixUnaryExpression(node) && (ts.isNumericLiteral(node.operand) || ts.isBigIntLiteral(node.operand)));
}

export function inspectInlineCore(files) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "core-architecture-"));
  try {
    const core = path.join(temporary, "src", "core");
    mkdirSync(core, { recursive: true });
    for (const [name, source] of Object.entries(files)) writeFileSync(path.join(core, name), source, "utf8");
    return inspectCoreDirectory(core).map(violation => violation.replace(/^.*?src[\\/]core[\\/]/u, ""));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function runSelfTest() {
  const mutants = [
    ["import { readFile } from 'node:fs';", "external or platform import"],
    ["export { readFile } from 'node:fs';", "external or platform re-export"],
    ["import fs = require('node:fs'); export const x = fs;", "import-equals"],
    ["export const seen = [];", "module-scope non-primitive"],
    ["let counter = 0; export function bump() { return counter++; }", "module-scope let/var"],
    ["export class Cache {}", "module-scope class"],
    ["export async function leak() { return import('node:fs/promises'); }", "dynamic import"],
    ["export function now() { return Date.now(); }", "not on the core allow-list"],
    ["export function now() { return Date['now'](); }", "not on the core allow-list"],
    ["export function today() { return Date(); }", "not on the core allow-list"],
    ["export function roll() { return Math.random(); }", "forbidden standard-library member 'Math.random'"],
    ["export function roll() { return Math['random'](); }", "forbidden standard-library member 'Math.random'"],
    ["export function key() { return process.env.KEY; }", "unresolved identifier 'process'"],
    ["export function key() { return globalThis['Date']; }", "not on the core allow-list"],
    ["export function key() { return eval('process.env.KEY'); }", "not on the core allow-list"],
    ["export function key() { return Function.bind(undefined)('return process.env.KEY')(); }", "not on the core allow-list"],
    ["export function key() { return global.process.env.KEY; }", "unresolved identifier 'global'"],
    ["export function now() { return global.Date.now(); }", "unresolved identifier 'global'"],
    ["export function fs() { return global.require('node:fs'); }", "unresolved identifier 'global'"],
    ["export function fs() { return require('node:fs'); }", "unresolved identifier 'require'"],
    ["export function make() { return (function () {}).constructor('return process')(); }", "forbidden reflective member"],
    ["export function make() { return (function () {})['constructor']('return process')(); }", "forbidden reflective member"],
    ["export function make(name: string) { const f = (function () {}) as unknown as Record<string, unknown>; return f[name]; }", "type assertion hides a callable value"],
    ["export function make(name: string, f: Record<string, unknown>) { return f[name]; }", "__PURE_COMPUTED_RECORD_ACCESS_ALLOWED__"],
    ["export function make(name: string) { const f = (() => 1) as any; return f[name](); }", "computed member access"],
    ["export function proto() { return Object.getPrototypeOf(() => 1); }", "forbidden standard-library member 'Object.getPrototypeOf'"],
    ["export function ref() { return Reflect.get({}, 'x'); }", "not on the core allow-list"],
    ["export function intl() { return new Intl.DateTimeFormat().format(0); }", "not on the core allow-list"],
    ["export function sym() { return Symbol.for('registry'); }", "forbidden standard-library member 'Symbol.for'"],
    ["export function later() { return Promise.resolve(1); }", "not on the core allow-list"],
    ["export function later() { return setTimeout(() => 1, 0); }", "unresolved identifier 'setTimeout'"],
    ["export function copy<T>(value: T): T { return structuredClone(value); }", "unresolved identifier 'structuredClone'"],
    ["declare const process: { env: Record<string, string> }; export function key() { return process.env.KEY; }", "ambient declaration is forbidden"],
    ["declare global { interface Window { x: number } } export const y = 1;", "global augmentation"],
    ["export function meta() { return import.meta.url; }", "import.meta"],
    ["export async function wait() { return await 1; }", "async code is forbidden"],
  ];
  for (const [source, expected] of mutants) {
    const found = inspectInlineCore({ "mutant.ts": source });
    if (expected === "__PURE_COMPUTED_RECORD_ACCESS_ALLOWED__") {
      if (found.length > 0) throw new Error(`architecture self-test rejected a typed record access: ${found.join("; ")}`);
      continue;
    }
    if (!found.some(violation => violation.includes(expected))) {
      throw new Error(`architecture self-test failed to catch: ${source}\n  found: ${found.join("; ") || "(nothing)"}`);
    }
  }
  const nonTypeScript = inspectInlineCore({ "pure.ts": "export const one = 1;", "leak.js": "module.exports = require('node:fs');" });
  if (!nonTypeScript.some(violation => violation.includes("only .ts source files"))) throw new Error("architecture self-test failed to catch a non-TypeScript core file");

  const pure = inspectInlineCore({
    "allowed.ts": [
      "declare const brand: unique symbol;",
      "export type Cents = number & { readonly [brand]: 'Cents' };",
      "export function add(left: number, right: number): number { return left + right; }",
      "export function own(record: Readonly<Record<string, number>>, key: string): number | undefined { return Object.hasOwn(record, key) ? record[key] : undefined; }",
      "export function big(values: readonly number[]): bigint { return values.map(value => BigInt(value)).reduce((total, value) => total + value, 0n); }",
      "export function safe(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value); }",
      "export function keys(record: Readonly<Record<string, unknown>>): readonly string[] { return Object.keys(record).sort(); }",
      "export function frozen<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }",
      "export function parse(raw: string): unknown { try { return JSON.parse(raw) as unknown; } catch { return null; } }",
      "export function collect(items: readonly string[]): ReadonlyMap<string, bigint> { const map = new Map<string, bigint>(); for (const item of items) map.set(item, 1n); return map; }",
      "export function fail(): never { throw new RangeError('boundary'); }",
      "export function encode(text: string): string { return encodeURIComponent(text); }",
    ].join("\n"),
  });
  if (pure.length > 0) throw new Error(`architecture self-test rejected pure source: ${pure.join("; ")}`);
}

if (process.argv.includes("--self-test")) runSelfTest();
const violations = inspectCoreDirectory(CORE_ROOT);
if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Architecture gate passed: ${CORE_ROOT} references only core code and the reviewed standard-library allow-list.\n`);
}
