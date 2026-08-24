/**
 * Assign columns (lanes) and polyline segments for a newest-first commit DAG.
 *
 * Ported from gitlane's layout.ts — the algorithm is the same; the grid is
 * sized for Plannotator's two-line commit rows rather than gitlane's 24px table.
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
        addLine(colour, { x: x1, y: y1 }, { x: x2, y: y2 }, isCommitted);
        continue;
      }
      const midY = y1 + 1;
      addLine(colour, { x: x1, y: y1 }, { x: x2, y: midY }, isCommitted);
      if (midY !== y2) {
        addLine(colour, { x: x2, y: midY }, { x: x2, y: y2 }, isCommitted);
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

/** True when the layout drew a polyline connecting childId → parentId. */
export function layoutHasParentEdge(
  layout: GraphLayout,
  childId: number,
  parentId: number,
): boolean {
  for (const branch of layout.branches) {
    const adj = new Map<number, Set<number>>();
    for (const line of branch.lines) {
      const a = line.p1.y;
      const b = line.p2.y;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
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
  }
  return false;
}
