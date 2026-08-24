import { describe, expect, test } from "bun:test";
import { attachRefs, commitRow, insertStashes, uncommittedCommit } from "./git-graph-model";
import { UNCOMMITTED_HASH } from "./git-graph-layout";

describe("insertStashes", () => {
  test("sits a stash immediately above its base and prepends the uncommitted node", () => {
    const log = [
      commitRow({ hash: "b", parents: ["a"], message: "base" }),
      commitRow({ hash: "a", parents: [], message: "root" }),
    ];
    const stashes = [
      {
        hash: "s",
        selector: "stash@{0}",
        baseHash: "b",
        date: 2,
        author: "A",
        email: "a@x",
        message: "WIP",
      },
    ];
    const out = insertStashes(log, stashes, uncommittedCommit("b", 1, 0));
    expect(out.map((c) => c.hash)).toEqual([UNCOMMITTED_HASH, "s", "b", "a"]);
    expect(out[1].stash?.selector).toBe("stash@{0}");
    expect(out[0].parents).toEqual(["b"]);
  });
});

describe("attachRefs", () => {
  test("attaches heads, tags, and remotes onto matching hashes", () => {
    const commits = [
      commitRow({ hash: "m", message: "merge" }),
      commitRow({ hash: "f", message: "feature" }),
    ];
    attachRefs(commits, {
      head: "m",
      heads: [
        { hash: "m", name: "main" },
        { hash: "f", name: "feature" },
      ],
      tags: [{ hash: "m", name: "v1.0", annotated: true }],
      remotes: [{ hash: "m", name: "origin/main" }],
    });
    expect(commits[0].heads).toEqual(["main"]);
    expect(commits[0].tags).toEqual([{ name: "v1.0", annotated: true }]);
    expect(commits[0].remotes).toEqual([{ name: "origin/main", remote: "origin" }]);
    expect(commits[1].heads).toEqual(["feature"]);
  });
});
