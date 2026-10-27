import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../lib/model-catalog-search.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { matchesModelSearch, matchesCatalogModel } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("plain model searches include substrings and ignore case and outer whitespace", () => {
  assert.equal(matchesModelSearch("WAI-Illustrious-SDXL", "  ILLUSTRIOUS "), true);
  assert.equal(matchesModelSearch("WAI-Illustrious-SDXL", "other"), false);
  assert.equal(matchesModelSearch("anything", ""), true);
});

test("glob wildcards match whole values, literal punctuation and Unicode characters", () => {
  for (const [value, query, expected] of [
    ["WAI-Illustrious-SDXL", "*illustrious*", true],
    ["WAI-Illustrious-SDXL", "wai*sdxl", true],
    ["WAI-Illustrious-SDXL", "illustrious*", false],
    ["Painter v12", "Painter v??", true],
    ["Painter v1", "Painter v??", false],
    ["Painter v123", "Painter v??", false],
    ["风景🌲模型", "风景?模型", true],
    ["[test].(v1)+", "[test].(v?)+", true],
    ["aaaaaaaaab", "*a*a*a*a*a*a*a*c", false],
    ["anything", "**", true],
    ["", "*", true],
    ["", "?", false],
  ]) assert.equal(matchesModelSearch(value, query), expected, `${value} / ${query}`);
});

test("catalog matching includes model names, older version names, numeric IDs and AIR IDs", () => {
  const model = { name: "Painter · Older", id: "urn:air:sdxl:checkpoint:civitai:101055@128078", searchTerms: ["Painter", "Older", "101055", "128078"] };
  for (const query of ["paint*", "old?r", "101*", "128078", "urn:air:sdxl:*@128078"]) assert.equal(matchesCatalogModel(model, query), true, query);
  assert.equal(matchesCatalogModel(model, "new*"), false);
});
