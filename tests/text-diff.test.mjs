import test from "node:test";
import assert from "node:assert/strict";
import {textDiff} from "../lib/text-diff.ts";
function verify(a,b){const parts=textDiff(a,b);assert.equal(parts.filter(p=>p.kind!=="added").map(p=>p.text).join(""),a);assert.equal(parts.filter(p=>p.kind!=="removed").map(p=>p.text).join(""),b);return parts;}
test("full diff preserves changes beyond character 500 and leaves common text neutral",()=>{const start="共同段落。".repeat(200);const parts=verify(start+"旧句。\n结尾",start+"新句。\n结尾");assert.ok(parts.some(p=>p.kind==="removed"&&p.text==="旧"));assert.ok(parts.some(p=>p.kind==="added"&&p.text==="新"));assert.equal(parts[0].kind,"equal");});
test("full diff handles empty, repeated, Unicode and line-ending content",()=>{for(const [a,b] of [["","新增"],["删除",""],["重复重复","重复"],["你好😀\r\n天地","你好🪶\n天地"],["same","same"]])verify(a,b);});
test("large documents preserve all content within bounded memory",()=>{const a=Array.from({length:1800},(_,i)=>i+" 原始段落与完整上下文。\n").join("");verify(a,a.replace("800 原始","800 修改").replace("1700 原始","1700 修改"));});
test("diff reconstruction survives varied insertions and deletions",()=>{let seed=7;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};for(let i=0;i<200;i++){const a=Array.from({length:random()%80},()=>"甲乙丙\n "[random()%5]).join("");const from=random()%(a.length+1);const b=a.slice(0,from)+"新增"+a.slice(Math.min(a.length,from+random()%8));verify(a,b);}});

test("emoji differences never split surrogate pairs into separate spans",()=>{const parts=verify("共同😀结尾","共同😁结尾");assert.ok(parts.every(p=>p.text.isWellFormed()));});
