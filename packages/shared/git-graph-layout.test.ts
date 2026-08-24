import { describe, expect, test } from "bun:test";
import { layoutGraph, layoutHasParentEdge } from "./git-graph-layout";

describe("layoutGraph", () => {
  test("assigns multiple lanes and parent edges for a branch+merge graph", () => {
    const commits = [
      { hash: "m", parents: ["t", "f"] },
      { hash: "t", parents: ["i"] },
      { hash: "f", parents: ["i"] },
      { hash: "i", parents: [] },
    ];
    const layout = layoutGraph(commits, { head: "m" });
    expect(layout.laneCount).toBeGreaterThan(1);
    expect(layout.vertices.length).toBe(4);
    expect(layout.vertices[0].isCurrent).toBe(true);
    expect(layoutHasParentEdge(layout, 0, 1)).toBe(true);
    expect(layoutHasParentEdge(layout, 0, 2)).toBe(true);
    expect(layoutHasParentEdge(layout, 1, 3)).toBe(true);
    expect(layoutHasParentEdge(layout, 2, 3)).toBe(true);
    expect(layout.branches.some((b) => b.lines.length > 0)).toBe(true);
  });

  test("places a stash on a fresh lane instead of looking up its hash", () => {
    const layout = layoutGraph(
      [
        { hash: "s", parents: ["b"], stash: { selector: "stash@{0}", baseHash: "b" } },
        { hash: "b", parents: ["a"] },
        { hash: "a", parents: [] },
      ],
      { head: "b" },
    );
    expect(layout.vertices[0].isStash).toBe(true);
    expect(layout.vertices[1].isStash).toBe(false);
    expect(layoutHasParentEdge(layout, 0, 1)).toBe(true);
  });
});
