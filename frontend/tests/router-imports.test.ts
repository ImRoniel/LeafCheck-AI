import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

// SDK 56+ rejects external React Navigation imports in application code.
// Exclude archived templates and tests; inspect every active source directory.
test("active frontend source uses Router-provided navigation modules", () => {
  const failures: string[] = [];
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        inspect(path);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        let specifier: ts.Node | undefined;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          specifier = node.moduleSpecifier;
        } else if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require"))
        ) {
          specifier = node.arguments[0];
        } else if (ts.isExternalModuleReference(node)) {
          specifier = node.expression;
        }
        if (
          specifier &&
          ts.isStringLiteralLike(specifier) &&
          specifier.text.startsWith("@react-navigation/")
        ) {
          const line =
            source.getLineAndCharacterOfPosition(specifier.getStart(source))
              .line + 1;
          failures.push(`${path}:${line}: ${specifier.text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  for (const directory of [
    "app",
    "components",
    "context",
    "hooks",
    "services",
    "constants",
    "types",
  ])
    inspect(directory);
  assert.deepEqual(
    failures,
    [],
    `SDK-incompatible navigation imports:\n${failures.join("\n")}`,
  );
});
