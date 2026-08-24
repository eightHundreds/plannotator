/**
 * Assign columns (lanes) and polyline segments for a newest-first commit DAG.
 *
 * Lane assignment is gitlane's (itself a simplification of mhutchie
 * vscode-git-graph). Verticals then join an existing rail on the parent
 * column instead of stacking a second collinear stroke — gitlane always
 * emitted a full child-colour vertical to the parent, which vscode-git-graph's
 * `determinePath` merge case avoids via `getPointConnectingTo`.
 *
 * Grid is sized for Plannotator's two-line commit rows rather than gitlane's
 * 24px table.
 */

export const UNCOMMITTED_HASH = "*";

export const GRAPH_COLOURS = [
  "#2563eb",
  "#db2777",
  "#16a34a",
  "#ea580c",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#c026d3",
  "#65a30d",
  "#c2410c",
  "#4f46e5",
  "#ca8a04",
];

/** Row-aligned grid. `y` must match the commit-row height in CommitsPanel. */
export const GRAPH_GRID = {
  x: 14,
  y: 44,
  offsetX: 12,
  offsetY: 22,
};

export type GraphPoint = { x: number; y: number };

export type GraphLine = {
  p1: GraphPoint;
  p2: GraphPoint;
  isCommitted: boolean;
  lockedFirst: boolean;
};

export type GraphLayout = {
  vertices: {
    id: number;
    x: number;
    colour: number;
    isCommitted: boolean;
    isCurrent: boolean;
    isStash: boolean;
  }[];
  branches: { colour: number; lines: GraphLine[] }[];
  laneCount: number;
  graphWidth: number;
  grid: { x: number; y: number; offsetX: number; offsetY: number };
  colours: string[];
};

function emptyLayout(): GraphLayout {
  return {
    vertices: [],
    branches: [],
    laneCount: 0,
    graphWidth: GRAPH_GRID.offsetX * 2,
    grid: { ...GRAPH_GRID },
    colours: GRAPH_COLOURS.slice(),
  };
}

/**
 * @param commits newest-first
 */
export function layoutGraph(
  commits: Array<{ hash: string; parents: string[]; stash?: unknown }>,
  opts: { head?: string | null } = {},
): GraphLayout {
  if (commits.length === 0) return emptyLayout();

  const head = opts.head ?? null;
  const n = commits.length;
  const lookup = Object.fromEntries(commits.map((c, i) => [c.hash, i]));
  const reserved: (string | null)[] = [];
  const laneColour: number[] = [];
  let nextColour = 0;
  const xOf = new Array<number>(n);
  const colourOf = new Array<number>(n);

  function newLane(hash: string | null) {
    const x = reserved.length;
    reserved.push(hash ?? null);
    laneColour.push(nextColour++);
    return x;
  }

  function freeLane() {
    return reserved.findIndex((h) => h == null);
  }

  function occupyFreeLane(hash: string | null) {
    const hole = freeLane();
    if (hole < 0) return newLane(hash);
    laneColour[hole] = nextColour++;
    return hole;
  }

  function placeCommit(hash: string, freshLane = false) {
    let x = freshLane ? -1 : reserved.indexOf(hash);
    if (x < 0) x = occupyFreeLane(hash);
    for (let j = 0; j < reserved.length; j++) {
      if (j !== x && reserved[j] === hash) reserved[j] = null;
    }
    return x;
  }

  function reserve(hash: string) {
    const existing = reserved.indexOf(hash);
    if (existing >= 0) return existing;
    const x = occupyFreeLane(hash);
    reserved[x] = hash;
    return x;
  }

  for (let i = 0; i < n; i++) {
    const x = placeCommit(commits[i].hash, Boolean(commits[i].stash));
    xOf[i] = x;
    colourOf[i] = laneColour[x];
    const parents = (commits[i].parents || []).filter((p) => typeof lookup[p] === "number");
    reserved[x] = parents[0] ?? null;
    for (let p = 1; p < parents.length; p++) reserve(parents[p]);
  }

  const linesByColour = new Map<number, GraphLine[]>();
  function addLine(
    colour: number,
    p1: GraphPoint,
    p2: GraphPoint,
    isCommitted: boolean,
  ) {
    let lines = linesByColour.get(colour);
    if (!lines) {
      lines = [];
      linesByColour.set(colour, lines);
    }
    lines.push({
      p1,
      p2,
      isCommitted,
      lockedFirst: p1.x < p2.x,
    });
  }

  // Per-column y-intervals already claimed by a vertical. A later edge that
  // would paint the same collinear span joins that rail instead of stacking.
  const occupied: { lo: number; hi: number }[][] = [];

  function occupyVertical(x: number, y1: number, y2: number) {
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    if (hi <= lo) return;
    const col = occupied[x] ?? (occupied[x] = []);
    col.push({ lo, hi });
    col.sort((a, b) => a.lo - b.lo);
    const merged: { lo: number; hi: number }[] = [];
    for (const iv of col) {
      const last = merged[merged.length - 1];
      if (last && iv.lo <= last.hi) last.hi = Math.max(last.hi, iv.hi);
      else merged.push({ lo: iv.lo, hi: iv.hi });
    }
    occupied[x] = merged;
  }

  function clipVertical(x: number, y1: number, y2: number): { lo: number; hi: number }[] {
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    if (hi <= lo) return [];
    let remaining = [{ lo, hi }];
    for (const occ of occupied[x] ?? []) {
      const next: { lo: number; hi: number }[] = [];
      for (const r of remaining) {
        if (occ.hi <= r.lo || occ.lo >= r.hi) {
          next.push(r);
          continue;
        }
        if (occ.lo > r.lo) next.push({ lo: r.lo, hi: Math.min(occ.lo, r.hi) });
        if (occ.hi < r.hi) next.push({ lo: Math.max(occ.hi, r.lo), hi: r.hi });
      }
      remaining = next.filter((iv) => iv.hi > iv.lo);
    }
    return remaining;
  }

  function addVertical(
    colour: number,
    x: number,
    y1: number,
    y2: number,
    isCommitted: boolean,
  ) {
    for (const iv of clipVertical(x, y1, y2)) {
      addLine(colour, { x, y: iv.lo }, { x, y: iv.hi }, isCommitted);
    }
    occupyVertical(x, y1, y2);
  }

  for (let i = 0; i < n; i++) {
    const isCommitted = commits[i].hash !== UNCOMMITTED_HASH;
    const parents = (commits[i].parents || []).filter((p) => typeof lookup[p] === "number");
    for (const parentHash of parents) {
      const pi = lookup[parentHash];
      const x1 = xOf[i];
      const y1 = i;
      const x2 = xOf[pi];
      const y2 = pi;
      const colour = colourOf[i];
      if (x1 === x2) {
        addVertical(colour, x1, y1, y2, isCommitted);
        continue;
      }
      const midY = y1 + 1;
      addLine(colour, { x: x1, y: y1 }, { x: x2, y: midY }, isCommitted);
      if (midY !== y2) {
        addVertical(colour, x2, midY, y2, isCommitted);
      }
    }
  }

  let maxX = 0;
  for (const x of xOf) if (x > maxX) maxX = x;
  const laneCount = Math.max(1, maxX + 1);

  const vertices = commits.map((c, i) => ({
    id: i,
    x: xOf[i],
    colour: colourOf[i],
    isCommitted: c.hash !== UNCOMMITTED_HASH,
    isCurrent:
      (head !== null && c.hash === head) ||
      (head === null && i === 0 && c.hash === UNCOMMITTED_HASH),
    isStash: Boolean(c.stash),
  }));

  const branches: GraphLayout["branches"] = [];
  for (const [colour, lines] of linesByColour) {
    branches.push({ colour, lines });
  }

  return {
    vertices,
    branches,
    laneCount,
    graphWidth: 2 * GRAPH_GRID.offsetX + Math.max(0, laneCount - 1) * GRAPH_GRID.x,
    grid: { ...GRAPH_GRID },
    colours: GRAPH_COLOURS.slice(),
  };
}

/**
 * True when the layout drew a polyline connecting childId → parentId.
 * Walks every colour: a merge that joined an existing parent-column rail is
 * still an edge even though its own colour stops at the join.
 */
export function layoutHasParentEdge(
  layout: GraphLayout,
  childId: number,
  parentId: number,
): boolean {
  const adj = new Map<number, Set<number>>();
  for (const branch of layout.branches) {
    for (const line of branch.lines) {
      const a = line.p1.y;
      const b = line.p2.y;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }
  const seen = new Set<number>();
  const stack = [childId];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === parentId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const nxt of adj.get(n) ?? []) stack.push(nxt);
  }
  return false;
}

/** Interior-overlapping collinear verticals (shared endpoints are joins, not overlaps). */
export function collinearVerticalOverlaps(
  layout: GraphLayout,
): { x: number; lo: number; hi: number; colours: [number, number] }[] {
  const verts: { x: number; lo: number; hi: number; colour: number }[] = [];
  for (const branch of layout.branches) {
    for (const line of branch.lines) {
      if (line.p1.x !== line.p2.x) continue;
      const lo = Math.min(line.p1.y, line.p2.y);
      const hi = Math.max(line.p1.y, line.p2.y);
      if (hi <= lo) continue;
      verts.push({ x: line.p1.x, lo, hi, colour: branch.colour });
    }
  }
  const overlaps: { x: number; lo: number; hi: number; colours: [number, number] }[] = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const a = verts[i];
      const b = verts[j];
      if (a.x !== b.x) continue;
      const lo = Math.max(a.lo, b.lo);
      const hi = Math.min(a.hi, b.hi);
      if (hi > lo) overlaps.push({ x: a.x, lo, hi, colours: [a.colour, b.colour] });
    }
  }
  return overlaps;
}
