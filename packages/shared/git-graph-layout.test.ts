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

  test("marks a stash vertex and still draws the edge to its base", () => {
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
    // alpha and beta each --no-ff merge feature tip F. vscode-git-graph joins
    // the second merge onto the first rail (getPointConnectingTo).
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

  test("a parent outside the loaded window still continues the branch to the last row", () => {
    // Feature's parent is not in this page; main fills the rows below.
    // gitlane dropped that edge; vscode-git-graph walks a null vertex to the end.
    const layout = layoutGraph(
      [
        { hash: "feature", parents: ["not-loaded"] },
        { hash: "m2", parents: ["m1"] },
        { hash: "m1", parents: ["also-not-loaded"] },
      ],
      { head: "feature" },
    );
    const lastRow = layout.vertices.length - 1;
    let featureMaxY = 0;
    for (const branch of layout.branches) {
      if (branch.colour !== layout.vertices[0].colour) continue;
      for (const line of branch.lines) {
        featureMaxY = Math.max(featureMaxY, line.p1.y, line.p2.y);
      }
    }
    expect(featureMaxY).toBe(lastRow);
    expect(layoutHasParentEdge(layout, 1, 2)).toBe(true);
  });
});
