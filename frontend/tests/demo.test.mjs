import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { demoCsv } from "../lib/csv.mjs";

const data = JSON.parse(await readFile(new URL("../../datasets/demo.json", import.meta.url), "utf8"));

test("each synthetic dimension has an example and a score for every model", () => {
  assert.equal(data.provenance, "synthetic");
  assert.equal(new Set(data.examples.map(({ dimension }) => dimension)).size, 4);
  for (const example of data.examples) {
    const row = data.scores.find(({ dimension }) => dimension.toLowerCase() === example.dimension);
    assert.ok(row);
    for (const name of data.models) assert.ok(Number.isFinite(row[name]) && row[name] >= 0 && row[name] <= 100);
  }
});

test("CSV includes provenance and escapes quotes", () => {
  const csv = demoCsv({ provenance: "synthetic", models: ['Atlas "A"'], scores: [{ dimension: "Recursion", 'Atlas "A"': 80 }] });
  assert.equal(csv, '"provenance","dimension","Atlas ""A"""\r\n"synthetic","Recursion","80"\r\n');
});
