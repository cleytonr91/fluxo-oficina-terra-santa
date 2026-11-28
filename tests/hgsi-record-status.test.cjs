const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const mod = { exports: {} };
const js = ts.transpileModule(fs.readFileSync("src/lib/hgsi/record-status.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function("require", "module", "exports", js)(require, mod, mod.exports);

const { isValidHgsiRecordStatus } = mod.exports;

test("respondido is a valid Route registration status", () => {
  assert.equal(isValidHgsiRecordStatus("Respondido"), true);
  assert.equal(isValidHgsiRecordStatus("Registro respondido"), true);
  assert.equal(isValidHgsiRecordStatus("Entrevista Realizada"), true);
});

test("invalid and unanswered statuses remain excluded", () => {
  assert.equal(isValidHgsiRecordStatus("Inválido"), false);
  assert.equal(isValidHgsiRecordStatus("Não válido"), false);
  assert.equal(isValidHgsiRecordStatus("Não respondido"), false);
  assert.equal(isValidHgsiRecordStatus("Realizada sem autorização"), false);
});

test("existing valid status labels remain accepted", () => {
  assert.equal(isValidHgsiRecordStatus("Registro válido"), true);
  assert.equal(isValidHgsiRecordStatus("Válido"), true);
});
