// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
const root = new URL("../../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const demo = "https://kairos03.github.io/shuttle-replay/demo/";

test("every README offers a prominent demo link before the overview", () => {
  const names = readdirSync(root).filter((n) => /^README(?:\.[\w-]+)?\.md$/.test(n));
  assert.equal(names.length, 10);
  for (const name of names) {
    const top = read(name).split(/^## /m)[0];
    assert.ok(top.includes(`<a href="${demo}"><strong>`), name);
  }
});

test("shared docs content includes a locale-safe demo entry before language choices", () => {
  const template = read("docs/_templates/page.html");
  assert.ok(template.indexOf('include "demo-link.html"') < template.indexOf('include "language-selector.html"'));
  assert.ok(template.includes('include "demo-link.html"'));
  const link = read("docs/_templates/demo-link.html");
  assert.ok(link.includes('href="{{ docs_site_url }}demo/"'));
  assert.ok(link.includes('"ko": "웹 데모 체험하기"'));
  for (const locale of ["en", "zh", "ja", "ru", "ko", "es", "fr", "de", "pt-BR", "it"]) {
    assert.ok(link.includes(`"${locale}":`), locale);
  }
});

test("README demo guidance describes the current empty-first, video-only picker", () => {
  assert.ok(!read("README.md").includes("It opens a synthetic sample"));
  assert.ok(!read("README.ko.md").includes("로컬 영상과 그 `analysis.json`"));
  assert.ok(read("README.md").includes("not automatically analyzed"));
  assert.ok(read("README.ko.md").includes("자동 분석하지 않습니다"));
});
