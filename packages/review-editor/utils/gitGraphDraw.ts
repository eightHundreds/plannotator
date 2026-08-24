/**
 * Turn a GraphLayout into SVG path/vertex pixels. Ported from gitlane's
 * renderGraph, without the expand-below-row offset (Plannotator shows commit
 * details in the center dock, not inline).
 */

import type { GraphLayout } from "@plannotator/shared/git-graph-history";

export type GraphDrawPath = {
  d: string;
  colour: string;
  isCommitted: boolean;
};

export type GraphDrawVertex = {
  id: number;
  cx: number;
  cy: number;
  colour: string;
  isCurrent: boolean;
  isStash: boolean;
  isCommitted: boolean;
};

export type GraphDrawModel = {
  width: number;
  height: number;
  paths: GraphDrawPath[];
  vertices: GraphDrawVertex[];
};

type PlacedLine = {
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  isCommitted: boolean;
};

function placeBranchLines(
  branch: GraphLayout["branches"][number],
  grid: GraphLayout["grid"],
): PlacedLine[] {
  return branch.lines.map((line) => ({
    p1: {
      x: line.p1.x * grid.x + grid.offsetX,
      y: line.p1.y * grid.y + grid.offsetY,
    },
    p2: {
      x: line.p2.x * grid.x + grid.offsetX,
      y: line.p2.y * grid.y + grid.offsetY,
    },
    isCommitted: line.isCommitted,
  }));
}

function pathsForBranch(
  branch: GraphLayout["branches"][number],
  grid: GraphLayout["grid"],
  colours: string[],
): GraphDrawPath[] {
  const colour = colours[branch.colour % colours.length];
  const dCurve = grid.y * 0.8;
  const placed = placeBranchLines(branch, grid);

  let i = 0;
  while (i < placed.length - 1) {
    const line = placed[i];
    const next = placed[i + 1];
    if (
      line.p1.x === line.p2.x &&
      line.p2.x === next.p1.x &&
      next.p1.x === next.p2.x &&
      line.p2.y === next.p1.y &&
      line.isCommitted === next.isCommitted
    ) {
      line.p2.y = next.p2.y;
      placed.splice(i + 1, 1);
    } else {
      i++;
    }
  }

  const out: GraphDrawPath[] = [];
  let curPath = "";
  for (i = 0; i < placed.length; i++) {
    const line = placed[i];
    const x1 = line.p1.x;
    const y1 = line.p1.y;
    const x2 = line.p2.x;
    const y2 = line.p2.y;
    if (curPath !== "" && i > 0 && line.isCommitted !== placed[i - 1].isCommitted) {
      out.push({ d: curPath, colour, isCommitted: placed[i - 1].isCommitted });
      curPath = "";
    }
    if (curPath === "" || (i > 0 && (x1 !== placed[i - 1].p2.x || y1 !== placed[i - 1].p2.y))) {
      curPath += `M${x1.toFixed(0)},${y1.toFixed(1)}`;
    }
    if (x1 === x2) {
      curPath += `L${x2.toFixed(0)},${y2.toFixed(1)}`;
    } else {
      curPath += `C${x1.toFixed(0)},${(y1 + dCurve).toFixed(1)} ${x2.toFixed(0)},${(y2 - dCurve).toFixed(1)} ${x2.toFixed(0)},${y2.toFixed(1)}`;
    }
  }
  if (curPath !== "") {
    out.push({ d: curPath, colour, isCommitted: placed[placed.length - 1].isCommitted });
  }
  return out;
}

export function buildGraphDrawModel(layout: GraphLayout): GraphDrawModel {
  const grid = layout.grid;
  const height = Math.max(layout.vertices.length * grid.y + grid.offsetY, grid.y);
  const width = Math.max(layout.graphWidth, grid.offsetX * 2);
  const paths: GraphDrawPath[] = [];
  for (const branch of layout.branches) {
    paths.push(...pathsForBranch(branch, grid, layout.colours));
  }
  const vertices: GraphDrawVertex[] = layout.vertices.map((v) => ({
    id: v.id,
    cx: v.x * grid.x + grid.offsetX,
    cy: v.id * grid.y + grid.offsetY,
    colour: v.isCommitted ? layout.colours[v.colour % layout.colours.length] : "#808080",
    isCurrent: v.isCurrent,
    isStash: v.isStash,
    isCommitted: v.isCommitted,
  }));
  return { width, height, paths, vertices };
}
