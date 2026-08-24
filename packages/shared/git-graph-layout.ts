/**
 * Assign columns (lanes) and polyline segments for a newest-first commit DAG.
 *
 * Path construction is mhutchie vscode-git-graph's `Graph.determinePath`
 * (`web/graph.ts`): unavailable points, merge join via `getPointConnectingTo`,
 * and a null vertex so a parent outside the loaded window still continues
 * the branch to the last visible row. Grid is sized for Plannotator's
 * two-line commit rows.
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

const NULL_VERTEX_ID = -1;

type VertexOrNull = Vertex | null;

class Branch {
  readonly colour: number;
  private end = 0;
  readonly lines: GraphLine[] = [];

  constructor(colour: number) {
    this.colour = colour;
  }

  addLine(p1: GraphPoint, p2: GraphPoint, isCommitted: boolean, lockedFirst: boolean) {
    this.lines.push({ p1, p2, isCommitted, lockedFirst });
  }

  getColour() {
    return this.colour;
  }

  setEnd(end: number) {
    this.end = end;
  }
}

class Vertex {
  readonly id: number;
  readonly isStash: boolean;
  private x = 0;
  private readonly parents: Vertex[] = [];
  private nextParent = 0;
  private onBranch: Branch | null = null;
  private isCommitted = true;
  private nextX = 0;
  private readonly connections: { connectsTo: VertexOrNull; onBranch: Branch }[] = [];

  constructor(id: number, isStash: boolean) {
    this.id = id;
    this.isStash = isStash;
  }

  addParent(vertex: Vertex) {
    this.parents.push(vertex);
  }

  getNextParent(): VertexOrNull {
    if (this.nextParent < this.parents.length) return this.parents[this.nextParent];
    return null;
  }

  registerParentProcessed() {
    this.nextParent++;
  }

  isMerge() {
    return this.parents.length > 1;
  }

  addToBranch(branch: Branch, x: number) {
    if (this.onBranch === null) {
      this.onBranch = branch;
      this.x = x;
    }
  }

  isNotOnBranch() {
    return this.onBranch === null;
  }

  getBranch() {
    return this.onBranch;
  }

  getPoint(): GraphPoint {
    return { x: this.x, y: this.id };
  }

  getNextPoint(): GraphPoint {
    return { x: this.nextX, y: this.id };
  }

  getPointConnectingTo(vertex: VertexOrNull, onBranch: Branch): GraphPoint | null {
    for (let i = 0; i < this.connections.length; i++) {
      const c = this.connections[i];
      if (c && c.connectsTo === vertex && c.onBranch === onBranch) {
        return { x: i, y: this.id };
      }
    }
    return null;
  }

  registerUnavailablePoint(x: number, connectsToVertex: VertexOrNull, onBranch: Branch) {
    if (x === this.nextX) {
      this.nextX = x + 1;
      this.connections[x] = { connectsTo: connectsToVertex, onBranch };
    }
  }

  getColour() {
    return this.onBranch !== null ? this.onBranch.getColour() : 0;
  }

  getIsCommitted() {
    return this.isCommitted;
  }

  setNotCommitted() {
    this.isCommitted = false;
  }

  getX() {
    return this.x;
  }
}

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
  const lookup: Record<string, number> = Object.fromEntries(commits.map((c, i) => [c.hash, i]));
  const nullVertex = new Vertex(NULL_VERTEX_ID, false);
  const vertices: Vertex[] = commits.map((c, i) => new Vertex(i, Boolean(c.stash)));

  for (let i = 0; i < n; i++) {
    const parents = commits[i].parents || [];
    for (let j = 0; j < parents.length; j++) {
      const parentHash = parents[j];
      if (typeof lookup[parentHash] === "number") {
        const parent = vertices[lookup[parentHash]];
        vertices[i].addParent(parent);
      } else {
        vertices[i].addParent(nullVertex);
      }
    }
  }

  if (commits[0].hash === UNCOMMITTED_HASH) {
    vertices[0].setNotCommitted();
  }

  const branches: Branch[] = [];
  const availableColours: number[] = [];

  function getAvailableColour(startAt: number) {
    for (let i = 0; i < availableColours.length; i++) {
      if (startAt > availableColours[i]) return i;
    }
    availableColours.push(0);
    return availableColours.length - 1;
  }

  function determinePath(startAt: number) {
    let i = startAt;
    let vertex = vertices[i];
    let parentVertex = vertices[i].getNextParent();
    let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();

    if (
      parentVertex !== null &&
      parentVertex.id !== NULL_VERTEX_ID &&
      vertex.isMerge() &&
      !vertex.isNotOnBranch() &&
      !parentVertex.isNotOnBranch()
    ) {
      let foundPointToParent = false;
      const parentBranch = parentVertex.getBranch()!;
      for (i = startAt + 1; i < vertices.length; i++) {
        const curVertex = vertices[i];
        let curPoint = curVertex.getPointConnectingTo(parentVertex, parentBranch);
        if (curPoint !== null) {
          foundPointToParent = true;
        } else {
          curPoint = curVertex.getNextPoint();
        }
        parentBranch.addLine(
          lastPoint,
          curPoint,
          vertex.getIsCommitted(),
          !foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true,
        );
        curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch);
        lastPoint = curPoint;
        if (foundPointToParent) {
          vertex.registerParentProcessed();
          break;
        }
      }
    } else {
      const branch = new Branch(getAvailableColour(startAt));
      vertex.addToBranch(branch, lastPoint.x);
      vertex.registerUnavailablePoint(lastPoint.x, vertex, branch);
      for (i = startAt + 1; i < vertices.length; i++) {
        const curVertex = vertices[i];
        const curPoint =
          parentVertex === curVertex && !parentVertex.isNotOnBranch()
            ? curVertex.getPoint()
            : curVertex.getNextPoint();
        branch.addLine(lastPoint, curPoint, vertex.getIsCommitted(), lastPoint.x < curPoint.x);
        curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branch);
        lastPoint = curPoint;
        if (parentVertex === curVertex) {
          vertex.registerParentProcessed();
          const parentVertexOnBranch = !parentVertex.isNotOnBranch();
          parentVertex.addToBranch(branch, curPoint.x);
          vertex = parentVertex;
          parentVertex = vertex.getNextParent();
          if (parentVertex === null || parentVertexOnBranch) break;
        }
      }
      if (i === vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) {
        vertex.registerParentProcessed();
      }
      branch.setEnd(i);
      branches.push(branch);
      availableColours[branch.getColour()] = i;
    }
  }

  let i = 0;
  while (i < vertices.length) {
    if (vertices[i].getNextParent() !== null || vertices[i].isNotOnBranch()) {
      determinePath(i);
    } else {
      i++;
    }
  }

  let maxNextX = 0;
  for (const v of vertices) {
    const x = v.getNextPoint().x;
    if (x > maxNextX) maxNextX = x;
  }
  const laneCount = Math.max(1, maxNextX);

  return {
    vertices: commits.map((c, idx) => ({
      id: idx,
      x: vertices[idx].getX(),
      colour: vertices[idx].getColour(),
      isCommitted: c.hash !== UNCOMMITTED_HASH,
      isCurrent:
        (head !== null && c.hash === head) ||
        (head === null && idx === 0 && c.hash === UNCOMMITTED_HASH),
      isStash: Boolean(c.stash),
    })),
    branches: branches.map((b) => ({ colour: b.getColour(), lines: b.lines })),
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
