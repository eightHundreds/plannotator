import { describe, expect, test } from "bun:test";
import {
  collinearVerticalOverlaps,
  layoutGraph,
  layoutHasParentEdge,
} from "./git-graph-layout";

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

  test("two --no-ff merges of the same parent do not stack collinear verticals", () => {
    // alpha and beta each --no-ff merge feature tip F. Gitlane paints a
    // child-colour vertical on F's column for every such merge; vscode-git-graph
    // joins the first rail. Newest-first order matches `git log --date-order`.
    const commits = [
      { hash: "MA", parents: ["A2", "F2"] },
      { hash: "MB", parents: ["B3", "F2"] },
      { hash: "A2", parents: ["A1"] },
      { hash: "B3", parents: ["B2"] },
      { hash: "F2", parents: ["F1"] },
      { hash: "A1", parents: ["base"] },
      { hash: "B2", parents: ["B1"] },
      { hash: "F1", parents: ["base"] },
      { hash: "B1", parents: ["base"] },
      { hash: "base", parents: [] },
    ];
    const layout = layoutGraph(commits, { head: "MB" });
    expect(collinearVerticalOverlaps(layout)).toEqual([]);
    expect(layoutHasParentEdge(layout, 0, 4)).toBe(true);
    expect(layoutHasParentEdge(layout, 1, 4)).toBe(true);
  });
});
