import { describe, expect, test } from "bun:test";
import { layoutGraph } from "@plannotator/shared/git-graph-layout";
import { buildGraphDrawModel } from "./gitGraphDraw";

describe("buildGraphDrawModel", () => {
  test("emits a path and a vertex per commit for a linear history", () => {
    const layout = layoutGraph(
      [
        { hash: "b", parents: ["a"] },
        { hash: "a", parents: [] },
      ],
      { head: "b" },
    );
    const draw = buildGraphDrawModel(layout);
    expect(draw.vertices.length).toBe(2);
    expect(draw.vertices[0].isCurrent).toBe(true);
    expect(draw.paths.length).toBeGreaterThan(0);
    expect(draw.height).toBeGreaterThan(0);
    expect(draw.width).toBeGreaterThan(0);
  });
});
