import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OUTLINE_NAMING_PROFILE,
  namingCharacterCount,
  normalizeGeneratedName,
  normalizeNamingProfile,
  validateGeneratedName,
} from "../lib/naming-options.ts";

test("naming formats validate five-character, seven-character and ci-pattern names", () => {
  const five = { ...DEFAULT_OUTLINE_NAMING_PROFILE, format: "five", lineCount: 2 };
  const seven = { ...DEFAULT_OUTLINE_NAMING_PROFILE, format: "seven", lineCount: 2 };
  const cipai = { ...DEFAULT_OUTLINE_NAMING_PROFILE, format: "cipai", lineCount: 2, cipai: "rumengling" };
  assert.deepEqual(validateGeneratedName("潮痕入旧梦\n雾锁旧孤城", five, 80), { valid: true, name: "潮痕入旧梦，雾锁旧孤城" });
  assert.equal(validateGeneratedName("雾锁孤城夜未央，潮回七码头旧梦", seven, 80).valid, true);
  assert.deepEqual(validateGeneratedName("如梦令：潮痕入梦\n雾锁孤城", cipai, 80), { valid: true, name: "潮痕入梦，雾锁孤城" });
  assert.equal(validateGeneratedName("潮痕入梦，雾锁孤城，月落", cipai, 80).valid, false);
  assert.equal(validateGeneratedName("潮痕入旧梦，雾锁城", five, 80).valid, false);
  assert.equal(validateGeneratedName("潮痕如梦令，雾锁孤城", cipai, 80).valid, false);
});

test("range counting ignores punctuation and generated names drop chapter numbering", () => {
  const profile = normalizeNamingProfile({ format: "range", minCharacters: 4, maxCharacters: 6 }, DEFAULT_OUTLINE_NAMING_PROFILE);
  assert.equal(namingCharacterCount("潮汐，回声！"), 4);
  assert.equal(validateGeneratedName("潮汐，回声！", profile, 80).valid, true);
  assert.equal(normalizeGeneratedName("第十二章·七码头潮汐", 80), "七码头潮汐");
});

test("legacy suspense style migrates to the expression setting", () => {
  const profile = normalizeNamingProfile({ style: "suspense" }, DEFAULT_OUTLINE_NAMING_PROFILE);
  assert.equal(profile.style, "modern");
  assert.equal(profile.expression, "suspense");
  assert.equal(profile.lineCount, 1);
  assert.equal(profile.cipai, "rumengling");
});
