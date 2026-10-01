import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { validateRows } from "../scripts/generate-capability-contract.mjs";

const run = promisify(execFile);
const scriptPath = resolve(import.meta.dirname, "../scripts/generate-capability-contract.mjs");
const phaseDirectory = resolve(import.meta.dirname, "../generated/capability");

async function readRows(file) {
  return JSON.parse(await readFile(resolve(phaseDirectory, file), "utf8")).rows;
}

test("generated Capability inventory has full source coverage", async () => {
  const [capabilities, tools, evals] = await Promise.all([
    readRows("capabilities.yaml"),
    readRows("mcp-tool-map.yaml"),
    readRows("eval-traceability.yaml"),
  ]);

  assert.equal(capabilities.length, 155);
  assert.equal(tools.length, 42);
  assert.equal(evals.length, 106);
  assert.equal(new Set(evals.map((row) => row.group)).size, 16);
  for (const row of [...capabilities, ...tools, ...evals]) {
    assert.match(row.sourceAnchor, /\S/);
    assert.match(row.semanticOperation, /\S/);
    assert.match(row.expectedMockState, /\S/);
  }
});

test("contract validation rejects missing, duplicate, and unclassified entries", () => {
  const row = {
    id: "example:1",
    sourceAnchor: "source.md#L1:example",
    primaryDisposition: "control_plane_owned",
  };

  assert.throws(() => validateRows([{ ...row, sourceAnchor: "" }], "fixture"), /source anchor/);
  assert.throws(() => validateRows([row, { ...row, id: "example:2" }], "fixture"), /duplicate source anchor/);
  assert.throws(() => validateRows([{ ...row, primaryDisposition: "unclassified" }], "fixture"), /valid primary disposition/);
});

test("entry-point guard runs the check when the script is invoked directly", async () => {
  // Regression: on a Windows checkout the old guard compared a raw path with a
  // file URL, so it was false and the script exited without running the drift
  // check. Invoking the script as a child process with --check must run the check
  // against the committed files and exit cleanly (execFile rejects on non-zero).
  const { stderr } = await run(process.execPath, [scriptPath, "--check"]);
  assert.equal(stderr, "");
});

test("module imports without a script path (node --eval / stdin)", async () => {
  // Regression: with no process.argv[1] the old guard called pathToFileURL on
  // undefined and threw before the caller could use the exports. Importing the
  // module from a context with no script argument must succeed and expose the
  // exported helpers.
  const href = pathToFileURL(scriptPath).href;
  const evalScript =
    `import(${JSON.stringify(href)}).then((m) => { ` +
    `m.validateRows([{ id: 'x:1', sourceAnchor: 'a.md#L1:x', primaryDisposition: 'control_plane_owned' }], 'fixture'); ` +
    `process.stdout.write('imported'); });`;
  const { stdout } = await run(process.execPath, ["--eval", evalScript]);
  assert.equal(stdout, "imported");
});
