const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const source = fs.readFileSync("src/app/pos-servico/identity.ts", "utf8");
const mod = { exports: {} };
new Function(
  "require",
  "module",
  "exports",
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
)(require, mod, mod.exports);

const { hasSharedIdentity, itemIdentityKeys, postCaseIdentityKeys } = mod.exports;

test("links a saved treatment by OS to the same customer displayed by chassis", () => {
  const itemKeys = itemIdentityKeys({ id: "flow-1", chassi: "9-BH 123", osNumber: " 4567 " });
  const treatmentKeys = postCaseIdentityKeys({ vehicleFlowId: "4567", chassi: "9BH123", osNumber: "4567" });

  assert.deepEqual(itemKeys, ["9BH123", "4567", "flow-1"]);
  assert.equal(hasSharedIdentity(itemKeys, treatmentKeys), true);
});

test("does not mix treatments belonging to different customers", () => {
  const first = itemIdentityKeys({ id: "flow-1", chassi: "AAA111", osNumber: "100" });
  const second = postCaseIdentityKeys({ vehicleFlowId: "BBB222", chassi: "BBB222", osNumber: "200" });

  assert.equal(hasSharedIdentity(first, second), false);
});
