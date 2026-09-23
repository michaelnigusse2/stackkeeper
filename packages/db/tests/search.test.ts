import assert from "node:assert/strict";
import test from "node:test";
import { escapeLike } from "../src/repo/search.ts";

/**
 * These matter because the failure is silent and wrong, not loud.
 *
 * A bare `%` in a LIKE pattern matches everything, so searching for it would
 * return the whole workspace -- and on a large one, slowly. A bare `_` matches
 * any single character, so `a_b` would quietly return `axb` and the person
 * would never know the search had answered a different question.
 */

test("leaves an ordinary term alone", () => {
  assert.equal(escapeLike("northgate"), "northgate");
  assert.equal(escapeLike("shop.northgate.co.uk"), "shop.northgate.co.uk");
  assert.equal(escapeLike("Pelham & Co"), "Pelham & Co");
});

test("escapes the percent wildcard, which would otherwise match everything", () => {
  assert.equal(escapeLike("%"), "\\%");
  assert.equal(escapeLike("100%"), "100\\%");
  assert.equal(escapeLike("%%"), "\\%\\%");
});

test("escapes the underscore wildcard, which matches any single character", () => {
  assert.equal(escapeLike("_"), "\\_");
  assert.equal(escapeLike("a_b"), "a\\_b");
  assert.equal(escapeLike("my_server_01"), "my\\_server\\_01");
});

test("escapes the backslash first, so its own escaping is not doubled", () => {
  // If the backslash were escaped last, escaping `%` would produce `\%` and
  // then the backslash pass would turn it into `\\%` -- a literal backslash
  // followed by a live wildcard, which is the bug this ordering prevents.
  assert.equal(escapeLike("\\"), "\\\\");
  assert.equal(escapeLike("\\%"), "\\\\\\%");
  assert.equal(escapeLike("a\\_b"), "a\\\\\\_b");
});

test("handles a term made entirely of wildcards", () => {
  assert.equal(escapeLike("%_%"), "\\%\\_\\%");
});

test("leaves an empty string empty", () => {
  assert.equal(escapeLike(""), "");
});
