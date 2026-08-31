import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const CORE_ROOT = path.resolve("src/core");
const FORBIDDEN_GLOBALS = new Set([
  "process",
  "globalThis",
  "window",
  "document",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "setTimeout",
  "setInterval",
  "console",
  "require",
  "Date",
  "performance",
  "crypto",
]);

function isPrimitiveConstant(node) {
  return ts.isStringLiteral(node)
    || ts.isNumericLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword
    || (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand));
}

export function inspectCoreSource(source, fileName = "inline.ts") {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];

  function inspectModuleSpecifier(moduleSpecifier, kind) {
    if (moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier)) {
      const specifier = moduleSpecifier.text;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        violations.push(`${fileName}: external or platform ${kind} '${specifier}'`);
      }
      if (specifier.split(/[\\/]/u).includes("shell")) {
        violations.push(`${fileName}: core ${kind}s shell module '${specifier}'`);
      }
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && fileName !== "inline.ts") {
        const importedPath = path.resolve(path.dirname(path.resolve(fileName)), specifier);
        if (importedPath !== CORE_ROOT && !importedPath.startsWith(`${CORE_ROOT}${path.sep}`)) {
          violations.push(`${fileName}: relative ${kind} escapes src/core '${specifier}'`);
        }
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) inspectModuleSpecifier(statement.moduleSpecifier, "import");
    if (ts.isExportDeclaration(statement)) inspectModuleSpecifier(statement.moduleSpecifier, "re-export");
    if (ts.isImportEqualsDeclaration(statement)) {
      violations.push(`${fileName}: import-equals is forbidden in the core`);
    }
    if (ts.isVariableStatement(statement)) {
      const isDeclare = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (!isConst) violations.push(`${fileName}: module-scope let/var is mutable global state`);
      for (const declaration of statement.declarationList.declarations) {
        if (!isDeclare && declaration.initializer !== undefined && !isPrimitiveConstant(declaration.initializer)) {
          violations.push(`${fileName}: module-scope non-primitive state is forbidden`);
        }
      }
    }
  }

  function visit(node) {
    if (ts.isIdentifier(node) && (node.text === "eval" || node.text === "Function")) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node)
        || (ts.isPropertySignature(parent) && parent.name === node);
      if (!isPropertyName) violations.push(`${fileName}: forbidden code generation '${node.text}'`);
    }
    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node)
        || (ts.isPropertySignature(parent) && parent.name === node);
      if (!isPropertyName) violations.push(`${fileName}: forbidden ambient global '${node.text}'`);
    }
    if (ts.isPropertyAccessExpression(node)) {
      const expression = node.expression.getText(sourceFile);
      const member = node.name.text;
      if ((expression === "Date" && member === "now") || (expression === "Math" && member === "random") || (expression === "performance" && member === "now") || (expression === "crypto" && (member === "randomUUID" || member === "getRandomValues"))) {
        violations.push(`${fileName}: forbidden ambient call '${expression}.${member}'`);
      }
      if (expression === "process" && member === "env") violations.push(`${fileName}: forbidden environment access 'process.env'`);
    }
    if (ts.isElementAccessExpression(node)) {
      const expression = node.expression.getText(sourceFile);
      const member = node.argumentExpression !== undefined && ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
      if ((expression === "Date" && member === "now")
        || (expression === "Math" && member === "random")
        || (expression === "performance" && member === "now")
        || (expression === "crypto" && (member === "randomUUID" || member === "getRandomValues"))) {
        violations.push(`${fileName}: forbidden ambient call '${expression}[${JSON.stringify(member)}]'`);
      }
    }
    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === "Date" && (node.arguments?.length ?? 0) === 0) {
      violations.push(`${fileName}: zero-argument Date construction reads ambient time`);
    }
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === "Date" && node.arguments.length === 0) {
      violations.push(`${fileName}: zero-argument Date call reads ambient time`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const target = node.arguments[0]?.getText(sourceFile) ?? "unknown";
      violations.push(`${fileName}: dynamic import is forbidden in the core (${target})`);
    }
    if (ts.isMetaProperty(node)) violations.push(`${fileName}: import.meta is forbidden in the core`);
    if (ts.isClassDeclaration(node) && node.parent === sourceFile) violations.push(`${fileName}: module-scope class may carry mutable static state`);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...new Set(violations)];
}

async function TypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return TypeScriptFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".ts") ? [absolute] : [];
  }));
  return nested.flat();
}

function runSelfTest() {
  const cases = [
    ["import { readFile } from 'node:fs';", "platform import"],
    ["export const seen = [];", "module-scope non-primitive"],
    ["let counter = 0;", "module-scope let/var"],
    ["export function now() { return Date.now(); }", "forbidden ambient"],
    ["export function key() { return process.env.KEY; }", "forbidden environment"],
    ["export function roll() { return Math.random(); }", "forbidden ambient"],
    ["export function today() { return Date(); }", "zero-argument Date"],
    ["export class Cache {}", "module-scope class"],
    ["export async function leak() { return import('node:fs/promises'); }", "dynamic import"],
    ["export { readFile } from 'node:fs';", "platform re-export"],
    ["export function now() { return Date['now'](); }", "forbidden ambient"],
    ["export function key() { return eval('process.env.KEY'); }", "forbidden code generation"],
    ["export function key() { return Function.bind(undefined)('return process.env.KEY')(); }", "forbidden code generation"],
    ["export function key() { return global.process.env.KEY; }", "forbidden"],
    ["export function now() { return global.Date.now(); }", "forbidden"],
    ["export function make() { return (function () {}).constructor('return process')(); }", "forbidden"],
    ["export function fs() { return global.require('node:fs'); }", "forbidden"],
  ];
  for (const [source, expected] of cases) {
    const found = inspectCoreSource(source, "self-test.ts");
    if (!found.some(violation => violation.includes(expected))) {
      throw new Error(`architecture self-test failed to catch: ${source}`);
    }
  }
  const allowed = inspectCoreSource("export function add(left: number, right: number) { return left + right; }", "allowed.ts");
  if (allowed.length > 0) throw new Error(`architecture self-test rejected pure source: ${allowed.join("; ")}`);
}

if (process.argv.includes("--self-test")) runSelfTest();
const violations = [];
for (const fileName of await TypeScriptFiles(CORE_ROOT)) {
  violations.push(...inspectCoreSource(await readFile(fileName, "utf8"), path.relative(process.cwd(), fileName)));
}
if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Architecture gate passed: ${CORE_ROOT} is free of declared I/O, ambient state, and mutable globals.\n`);
}
