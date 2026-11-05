/**
 * Where the plan viewer draws each node, box and arrow. Pure: the codes, the arrows, the stage and the group of
 * each node in; positions and routes out. The server `plan-view.ts` gives the result to the page, which only draws
 * it. No library: the graph is small, and the cells below need a layout that no layered library keeps (a library
 * cannot hold a partition inside a compound node).
 *
 * - **Stage bands.** One column for each stage, side by side, with a gap between them; a stage with no node is a
 *   narrow band.
 * - **Cells.** In a band, the nodes of no group are one cell, and the nodes of one group are one cell, in a box. A
 *   group with nodes in two stages has a box in each band. A band stacks its cells top to bottom: the cell of no
 *   group first, then the groups in chart order. The bands are not aligned with each other.
 * - **In a cell**, a node's layer is the longest path to it over the arrows of the cell, and the order in a layer
 *   follows the mean place of its neighbours.
 * - **Arrows.** `edges`: an arrow that crosses the edge of a box ends at the box: it leaves from the middle of the
 *   right side, and enters at the middle of the left side. Arrows that then have the same two ends are one, and
 *   `via` names the arrows of the plan that it stands for. `all`: each arrow from node to node.
 * - **No arrow runs through a node or a name** (of a band, or of a box). An arrow goes up or down only in the gap
 *   between two layers of a cell, or in the side padding of a band; it goes along a level only where no node and no
 *   name is.
 * - **No two arrows run on one line.** Each arrow between two cells has a track of its own in the padding of each
 *   band; then `separate` moves each part that lies on another arrow to the nearest free track. Two arrows share a
 *   line only out of one start or into one end.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LayoutInput {
  /** The codes of the nodes, in chart order. */
  nodes: string[];
  edges: { from: string; to: string }[];
  /** The stage bands, in order. */
  stages: string[];
  /** The stage of each node; a node with none is in the first stage. */
  stageOf: Record<string, string>;
  /** The group of each node, or none. */
  groupOf: Record<string, string | null>;
}

export interface LayoutBand {
  stage: string;
  x: number;
  width: number;
  /** No node is in it. */
  empty: boolean;
}

export interface LayoutBox {
  /** `<group>@<stage>`: a group has a box in each band where it has nodes. */
  id: string;
  group: string;
  stage: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The first box of the group, from the left: it names the group. */
  first: boolean;
}

export interface LayoutEdge {
  /** A node code, or `box:<box id>`. */
  from: string;
  to: string;
  /** The arrows of the plan that it stands for, as `<from>><to>`. */
  via: string[];
  points: Point[];
}

export interface PlanLayout {
  node: { width: number; height: number };
  bands: LayoutBand[];
  /** The top left of each node. */
  nodes: Record<string, Point>;
  boxes: LayoutBox[];
  /** The arrows, with the ports of the boxes. */
  edges: LayoutEdge[];
  /** Each arrow from node to node. */
  all: LayoutEdge[];
  width: number;
  height: number;
}

export const NODE_W = 172;
export const NODE_H = 66;
/** Between two layers of a cell. */
const LAYER_GAP = 48;
/** Between two nodes of a layer. */
const ROW_GAP = 16;
/** The least side padding of a band. The arrows go up and down in it, each on a track of its own: a band has a
 *  track on its left for each arrow into it, and on its right for each arrow out of it. */
const BAND_PAD = 30;
/** The empty space between two bands. */
const BAND_GAP = 24;
/** The width of a band with no node: room for its name. */
const EMPTY_BAND = 84;
/** Room above the cells: the names of the bands, then a level for arrows. */
export const BAND_HEAD = 50;
/** The names of the bands: no arrow goes through them. */
export const BAND_NAME = 28;
/** Inside a box: the padding, and the room for its two lines of name and state. */
const BOX_PAD = 14;
export const BOX_HEAD = 34;
/** Between two cells of a band. */
const CELL_GAP = 30;
/** How much lower on a side an arrow back to an earlier band ends. */
const BACK_LOW = 16;
/** What a bend of an arrow costs, as a length. */
const BEND = 40;
/** The space between two arrows that run side by side. */
const TRACK = 6;

export const BOX_PREFIX = "box:";

interface Cell {
  id: string;
  stage: number;
  group: string | null;
  codes: string[];
  /** Relative to the inside of the cell. */
  at: Map<string, Point & { layer: number }>;
  width: number;
  height: number;
  /** Set by the stacking: the outside of the cell (the box), and the top left of its inside. */
  x: number;
  y: number;
  outerW: number;
  outerH: number;
  inner: Point;
}

/** Lay out one cell: layers by the longest path, the order in a layer by the mean of the neighbours, then each
 *  row pulled to the level of its neighbours. `hint` is the level (the top of the node, inside the cell) of the
 *  neighbours of a node in other cells: a node with no neighbour in the cell goes to it. */
function layCell(codes: string[], edges: { from: string; to: string }[], hint = new Map<string, number>()): Pick<Cell, "at" | "width" | "height"> {
  const has = new Set(codes);
  const inner = edges.filter((e) => has.has(e.from) && has.has(e.to) && e.from !== e.to);
  const succ = new Map(codes.map((c) => [c, [] as string[]])), pred = new Map(codes.map((c) => [c, [] as string[]]));
  // Break loops: a back arrow of a depth-first walk in chart order does not set a layer.
  const mark = new Map<string, number>(), back = new Set<string>();
  const out = new Map(codes.map((c) => [c, [] as string[]]));
  for (const e of inner) out.get(e.from)?.push(e.to);
  const dfs = (c: string) => {
    mark.set(c, 1);
    for (const s of out.get(c) ?? []) {
      if (mark.get(s) === 1) back.add(`${c}>${s}`);
      else if (!mark.get(s)) dfs(s);
    }
    mark.set(c, 2);
  };
  for (const c of codes) if (!mark.get(c)) dfs(c);
  for (const e of inner) {
    if (back.has(`${e.from}>${e.to}`)) continue;
    succ.get(e.from)?.push(e.to);
    pred.get(e.to)?.push(e.from);
  }
  const layer = new Map<string, number>();
  const layerOf = (c: string): number => {
    const known = layer.get(c);
    if (known !== undefined) return known;
    const ps = pred.get(c) ?? [];
    const l = ps.length ? 1 + Math.max(...ps.map(layerOf)) : 0;
    layer.set(c, l);
    return l;
  };
  codes.forEach(layerOf);
  // Pull each node right, next to the first node that waits on it (a D sits by what it holds).
  for (const c of [...codes].sort((a, z) => (layer.get(z) ?? 0) - (layer.get(a) ?? 0))) {
    const s = succ.get(c) ?? [];
    if (s.length) layer.set(c, Math.max(layer.get(c) ?? 0, Math.min(...s.map((x) => layer.get(x) ?? 0)) - 1));
  }
  const L = Math.max(0, ...layer.values()) + 1;
  const layers: string[][] = Array.from({ length: L }, () => []);
  for (const c of codes) layers[layer.get(c) ?? 0].push(c);
  // The order that the other cells ask for first; the neighbours in the cell then sort it again.
  for (const l of layers) {
    const key = new Map(l.map((c, i) => [c, hint.get(c) ?? i * (NODE_H + ROW_GAP)]));
    l.sort((a, z) => (key.get(a) ?? 0) - (key.get(z) ?? 0));
  }
  const index = new Map<string, number>();
  layers.forEach((l) => l.forEach((c, i) => index.set(c, i)));
  const bary = (c: string, nb: Map<string, string[]>) => {
    const ns = nb.get(c) ?? [];
    return ns.length ? ns.reduce((s, x) => s + (index.get(x) ?? 0), 0) / ns.length : (index.get(c) ?? 0);
  };
  const order = (l: number, nb: Map<string, string[]>) => {
    const key = new Map(layers[l].map((c) => [c, bary(c, nb)]));
    layers[l].sort((a, z) => (key.get(a) ?? 0) - (key.get(z) ?? 0));
    layers[l].forEach((c, i) => index.set(c, i));
  };
  for (let it = 0; it < 6; it++) {
    for (let l = 1; l < L; l++) order(l, pred);
    for (let l = L - 2; l >= 0; l--) order(l, succ);
  }
  const step = NODE_H + ROW_GAP;
  const y = new Map<string, number>();
  for (const l of layers) l.forEach((c, i) => y.set(c, i * step));
  const place = (l: string[], nb: Map<string, string[]>) => {
    // A node with no neighbour on that side sits right under the node before it.
    const want = l.map((c) => {
      const ns = nb.get(c) ?? [];
      return ns.length ? ns.reduce((s, x) => s + (y.get(x) ?? 0), 0) / ns.length : Number.NaN;
    });
    want.forEach((w, i) => {
      if (Number.isNaN(w)) want[i] = i ? want[i - 1] + step : (y.get(l[i]) ?? 0);
    });
    for (let i = l.length - 2; i >= 0; i--) want[i] = Math.min(want[i], want[i + 1] - step);
    for (let i = 1; i < l.length; i++) want[i] = Math.max(want[i], want[i - 1] + step);
    l.forEach((c, i) => y.set(c, want[i]));
  };
  for (let it = 0; it < 4; it++) {
    for (let l = 1; l < L; l++) place(layers[l], pred);
    for (let l = L - 2; l >= 0; l--) place(layers[l], succ);
  }
  const minY = Math.min(0, ...y.values());
  const at = new Map<string, Point & { layer: number }>();
  for (const c of codes) at.set(c, { x: (layer.get(c) ?? 0) * (NODE_W + LAYER_GAP), y: Math.round((y.get(c) ?? 0) - minY), layer: layer.get(c) ?? 0 });
  const height = Math.max(0, ...[...at.values()].map((p) => p.y)) + NODE_H;
  return { at, width: L * (NODE_W + LAYER_GAP) - LAYER_GAP, height };
}

export function planLayout(input: LayoutInput): PlanLayout {
  const stages = input.stages.length ? input.stages : [""];
  const stageIndex = (c: string) => Math.max(0, stages.indexOf(input.stageOf[c] ?? stages[0]));
  // The cells, in the order a band stacks them.
  const firstAt = new Map<string, number>();
  input.nodes.forEach((c, i) => {
    const g = input.groupOf[c];
    if (g && !firstAt.has(g)) firstAt.set(g, i);
  });
  const byId = new Map<string, Cell>();
  for (const c of input.nodes) {
    const stage = stageIndex(c), group = input.groupOf[c] ?? null;
    const id = group === null ? `@${stages[stage]}` : `${group}@${stages[stage]}`;
    const cell = byId.get(id) ?? ({ id, stage, group, codes: [] } as unknown as Cell);
    cell.codes.push(c);
    byId.set(id, cell);
  }
  const rank = (c: Cell) => (c.group === null ? -1 : (firstAt.get(c.group) ?? 0));
  const cells = [...byId.values()].sort((a, z) => a.stage - z.stage || rank(a) - rank(z));
  for (const cell of cells) Object.assign(cell, layCell(cell.codes, input.edges));
  // The bands, side by side.
  // The arrows between two cells, for the tracks in the paddings of the bands.
  const cellOfCode = new Map<string, Cell>();
  for (const cell of cells) for (const c of cell.codes) cellOfCode.set(c, cell);
  const ins = stages.map(() => 0), outs = stages.map(() => 0);
  for (const e of input.edges) {
    const a = cellOfCode.get(e.from), b = cellOfCode.get(e.to);
    if (!a || !b || a === b) continue;
    // An arrow back to an earlier band leaves from the left and enters from the right.
    if (b.stage < a.stage) {
      ins[a.stage]++;
      outs[b.stage]++;
    } else if (b.stage === a.stage) {
      // In one band: out of the right side and into the right side, both in the right padding.
      outs[a.stage] += 2;
    } else {
      outs[a.stage]++;
      ins[b.stage]++;
    }
  }
  const padL = ins.map((n) => Math.max(BAND_PAD, TRACK * (n + 2)));
  const padR = outs.map((n) => Math.max(BAND_PAD, TRACK * (n + 2)));
  const outer = (c: Cell) => ({ w: c.width + (c.group ? 2 * BOX_PAD : 0), h: c.height + (c.group ? BOX_HEAD + 2 * BOX_PAD : 0) });
  const bands: LayoutBand[] = [];
  let x = 0;
  stages.forEach((stage, i) => {
    const mine = cells.filter((c) => c.stage === i);
    const width = mine.length ? Math.max(...mine.map((c) => outer(c).w)) + padL[i] + padR[i] : EMPTY_BAND;
    if (i) x += BAND_GAP;
    bands.push({ stage, x, width, empty: mine.length === 0 });
    x += width;
  });
  // Stack the cells of each band. Then two rounds: each node goes to the level of its neighbours in other cells,
  // and the boxes of a band go in the order of the levels of their neighbours, so the arrows between cells are
  // short. The cell of no group stays first.
  let nodes: Record<string, Point> = {};
  let boxes: LayoutBox[] = [];
  let bottom = stages.map(() => BAND_HEAD);
  const stack = () => {
  bottom = stages.map(() => BAND_HEAD);
  nodes = {};
  boxes = [];
  const seenGroup = new Set<string>();
  for (const cell of cells) {
    const o = outer(cell);
    cell.x = bands[cell.stage].x + padL[cell.stage];
    cell.y = bottom[cell.stage];
    cell.outerW = o.w;
    cell.outerH = o.h;
    cell.inner = cell.group ? { x: cell.x + BOX_PAD, y: cell.y + BOX_HEAD + BOX_PAD } : { x: cell.x, y: cell.y };
    for (const [c, p] of cell.at) nodes[c] = { x: cell.inner.x + p.x, y: cell.inner.y + p.y };
    if (cell.group) {
      boxes.push({ id: cell.id, group: cell.group, stage: stages[cell.stage], x: cell.x, y: cell.y, width: o.w, height: o.h, first: !seenGroup.has(cell.group) });
      seenGroup.add(cell.group);
    }
    bottom[cell.stage] = cell.y + o.h + CELL_GAP;
  }
  };
  stack();
  const neighbours = new Map<string, string[]>();
  for (const e of input.edges) {
    const a = cellOfCode.get(e.from), b = cellOfCode.get(e.to);
    if (!a || !b || a === b) continue;
    neighbours.set(e.from, [...(neighbours.get(e.from) ?? []), e.to]);
    neighbours.set(e.to, [...(neighbours.get(e.to) ?? []), e.from]);
  }
  for (let round = 0; round < 2; round++) {
    const level = new Map<string, number>();
    for (const [c, ns] of neighbours) level.set(c, ns.reduce((sum, n) => sum + nodes[n].y, 0) / ns.length);
    for (const cell of cells) {
      const hint = new Map<string, number>();
      for (const c of cell.codes) {
        const l = level.get(c);
        if (l !== undefined) hint.set(c, Math.max(0, l - cell.inner.y));
      }
      Object.assign(cell, layCell(cell.codes, input.edges, hint));
    }
    const mean = (c: Cell) => {
      const ls = c.codes.map((x) => level.get(x)).filter((l): l is number => l !== undefined);
      return ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : c.y;
    };
    const keys = new Map(cells.map((c) => [c, mean(c)]));
    cells.sort((a, z) => a.stage - z.stage || (a.group === null ? -1 : 0) - (z.group === null ? -1 : 0) || (keys.get(a) ?? 0) - (keys.get(z) ?? 0));
    stack();
  }
  const width = x;
  const height = Math.max(BAND_HEAD, ...bottom) - CELL_GAP / 2;
  const obstacles = obstaclesOf({ nodes, boxes, bands });
  // One router for each set of arrows: each takes its own tracks.
  const routeAll = router(cells, bands, obstacles, padL, padR);
  const routePorts = router(cells, bands, obstacles, padL, padR);
  const cellOf = cellOfCode;
  const all: LayoutEdge[] = [];
  const merged = new Map<string, LayoutEdge>();
  for (const e of input.edges) {
    const a = cellOf.get(e.from), b = cellOf.get(e.to);
    if (!a || !b || e.from === e.to) continue;
    const via = `${e.from}>${e.to}`;
    all.push({ from: e.from, to: e.to, via: [via], points: routeAll(e.from, e.to) });
    // The ports: an arrow that leaves or enters a box ends at the box.
    const from = a.group && a !== b ? `${BOX_PREFIX}${a.id}` : e.from;
    const to = b.group && a !== b ? `${BOX_PREFIX}${b.id}` : e.to;
    const key = `${from}\u0000${to}`;
    const m = merged.get(key);
    if (m) m.via.push(via);
    else merged.set(key, { from, to, via: [via], points: routePorts(from, to) });
  }
  // Each set of arrows apart: no two arrows on one line.
  const apart = (list: LayoutEdge[]) => {
    const moved = separate(list.map((e) => e.points), obstacles);
    return list.map((e, i) => ({ ...e, points: tidy(moved[i]) }));
  };
  const edges = apart([...merged.values()]), each = apart(all);
  const points = [...edges, ...each].flatMap((e) => e.points);
  return {
    node: { width: NODE_W, height: NODE_H },
    bands,
    nodes,
    boxes,
    edges,
    all: each,
    width: Math.max(width, ...points.map((p) => p.x + 4)),
    height: Math.max(height, ...points.map((p) => p.y + 4)),
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True when the level or upright segment a–b passes through the inside of the rectangle. */
export function crosses(a: Point, b: Point, r: Rect): boolean {
  return Math.max(a.x, b.x) > r.x + 1 && Math.min(a.x, b.x) < r.x + r.w - 1 && Math.max(a.y, b.y) > r.y + 1 && Math.min(a.y, b.y) < r.y + r.h - 1;
}

/** True when two segments lie on one line and share more than a point. */
export function overlaps(a: Point, b: Point, c: Point, d: Point): boolean {
  if (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < 0.5) {
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 1;
  }
  if (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < 0.5) {
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 1;
  }
  return false;
}

/** The rectangles that no arrow goes through: the nodes, the names of the boxes, the names of the bands. */
export function obstaclesOf(layout: Pick<PlanLayout, "nodes" | "boxes" | "bands">): Rect[] {
  return [
    ...Object.values(layout.nodes).map((n) => ({ x: n.x, y: n.y, w: NODE_W, h: NODE_H })),
    ...layout.boxes.map((b) => ({ x: b.x, y: b.y, w: b.width, h: BOX_HEAD })),
    ...layout.bands.map((b) => ({ x: b.x, y: 0, w: b.width, h: BAND_NAME })),
  ];
}

/** The routes: each one a list of points, from the right side of its start to the left side of its end. A route
 *  keeps its bends that do not turn (a jog of no length), so `separate` can still move each part of it; `tidy`
 *  drops them after. */
function router(cells: Cell[], bands: LayoutBand[], obstacles: Rect[], padL: number[], padR: number[]) {
  const usedIn = bands.map(() => 0), usedOut = bands.map(() => 0);
  const free = (y: number, xa: number, xb: number) => !obstacles.some((r) => crosses({ x: xa, y }, { x: xb, y }, r));
  const freeDown = (x: number, ya: number, yb: number) => !obstacles.some((r) => crosses({ x, y: ya }, { x, y: yb }, r));
  const nodeAt = new Map<string, Point>();
  const cellOf = new Map<string, Cell>();
  for (const cell of cells) {
    for (const [c, p] of cell.at) {
      cellOf.set(c, cell);
      nodeAt.set(c, { x: cell.inner.x + p.x, y: cell.inner.y + p.y });
    }
    cellOf.set(`${BOX_PREFIX}${cell.id}`, cell);
  }
  /** The uprights where no node is: the middle of each side padding, and of each gap between two bands. */
  const uprights = bands.flatMap((b, i) => [b.x + padL[i] / 2, b.x + b.width - padR[i] / 2, ...(i ? [b.x - BAND_GAP / 2] : [])]);
  /** The levels between cells, and above them all, under the names of the bands. */
  const lanes = [(BAND_NAME + BAND_HEAD) / 2, ...cells.flatMap((c) => [c.y - CELL_GAP / 2, c.y + c.outerH + CELL_GAP / 2])];
  /** The free levels over and under the nodes of a cell: inside its box, under the name; or between the cells. */
  const rims = (c: Cell) =>
    c.group ? [c.inner.y - BOX_PAD / 2, c.inner.y + c.height + BOX_PAD / 2] : [c.y - CELL_GAP / 2, c.y + c.outerH + CELL_GAP / 2];
  /** The end of an arrow on the right or the left side of a node or a box: the middle of the side, or, for an arrow
   *  back to an earlier band, lower on the side, so it does not meet the arrows forwards there. */
  const endOf = (code: string, side: "right" | "left", back: boolean): Point => {
    const cell = cellOf.get(code) as Cell;
    const low = back ? BACK_LOW : 0;
    if (code.startsWith(BOX_PREFIX)) return { x: side === "right" ? cell.x + cell.outerW : cell.x, y: cell.y + cell.outerH / 2 + low };
    const n = nodeAt.get(code) as Point;
    return { x: side === "right" ? n.x + NODE_W : n.x, y: n.y + NODE_H / 2 + low };
  };
  /** The way from an end to the side padding of its band at `pad`: points from the end outwards, and the level
   *  where it reaches the padding. */
  const leg = (code: string, end: Point, pad: number) => {
    if (free(end.y, end.x, pad)) return { points: [end], y: end.y };
    const cell = cellOf.get(code) as Cell;
    const jog = end.x + Math.sign(pad - end.x) * (LAYER_GAP / 2);
    const tries = rims(cell).sort((a, z) => Math.abs(a - end.y) - Math.abs(z - end.y));
    const y = tries.find((l) => freeDown(jog, end.y, l) && free(l, jog, pad)) ?? tries[0];
    return { points: [end, { x: jog, y: end.y }, { x: jog, y }], y };
  };
  return (from: string, to: string): Point[] => {
    const a = cellOf.get(from) as Cell, b = cellOf.get(to) as Cell;
    // An arrow back to an earlier band leaves the left side of its start and enters the right side of its end: the
    // nearest sides, so it does not go round both bands.
    // An arrow to another cell of the same band enters the right side too.
    const back = b.stage < a.stage, side = a !== b && b.stage === a.stage;
    const s = endOf(from, back ? "left" : "right", back), t = endOf(to, back || side ? "right" : "left", back || side);
    // In one cell, forwards: down or up in the layer gaps, along a free level between them.
    if (a === b && !from.startsWith(BOX_PREFIX) && !to.startsWith(BOX_PREFIX) && t.x > s.x) {
      const xs = s.x + LAYER_GAP / 2, xt = t.x - LAYER_GAP / 2;
      if (xs >= xt) return [s, { x: xs, y: s.y }, { x: xs, y: t.y }, t];
      const [over, under] = rims(a);
      const y = [s.y, t.y, ...[under, over].sort((p, q) => Math.abs(p - s.y) - Math.abs(q - s.y))].find((l) => free(l, xs, xt) && freeDown(xs, s.y, l) && freeDown(xt, l, t.y)) ?? under;
      return [s, { x: xs, y: s.y }, { x: xs, y }, { x: xt, y }, { x: xt, y: t.y }, t];
    }
    // Between cells: out to a track of its own in the right padding of the band of the start, then the shortest
    // way to a track of its own in the left padding of the band of the end, and in. The way goes along free levels,
    // and up or down only in a padding or in the gap between two bands.
    const outX = back
      ? bands[a.stage].x + padL[a.stage] - TRACK * ++usedIn[a.stage]
      : bands[a.stage].x + bands[a.stage].width - padR[a.stage] + TRACK * ++usedOut[a.stage];
    const inX = back || side
      ? bands[b.stage].x + bands[b.stage].width - padR[b.stage] + TRACK * ++usedOut[b.stage]
      : bands[b.stage].x + padL[b.stage] - TRACK * ++usedIn[b.stage];
    const out = leg(from, s, outX), into = leg(to, t, inX);
    const middle = tidy(shortest({ x: outX, y: out.y }, { x: inX, y: into.y }));
    return alternate([...out.points, ...middle, ...[...into.points].reverse()]);
  };

  /** The shortest way from `p` to `q` on the grid of the free uprights (the paddings and the gaps of the bands) and
   *  the free levels (between the cells, over them, and the levels of the two ends). A bend costs as much as
   *  `BEND` of length, so the way turns only where it saves more. */
  function shortest(p: Point, q: Point): Point[] {
    const xs = [...new Set([p.x, q.x, ...uprights])].sort((u, v) => u - v);
    const ys = [...new Set([p.y, q.y, ...lanes])].sort((u, v) => u - v);
    const key = (i: number, j: number, d: number) => (i * ys.length + j) * 2 + d;
    const start = { i: xs.indexOf(p.x), j: ys.indexOf(p.y) }, goal = { i: xs.indexOf(q.x), j: ys.indexOf(q.y) };
    const dist = new Map<number, number>(), prev = new Map<number, number>();
    // d: 0 the last move was along a level, 1 up or down.
    const open: [number, number, number, number][] = [[0, start.i, start.j, 0], [0, start.i, start.j, 1]];
    dist.set(key(start.i, start.j, 0), 0);
    dist.set(key(start.i, start.j, 1), 0);
    let end = -1;
    while (open.length) {
      open.sort((u, v) => u[0] - v[0]);
      const [c, i, j, d] = open.shift() as [number, number, number, number];
      const k = key(i, j, d);
      if (c > (dist.get(k) ?? Number.POSITIVE_INFINITY)) continue;
      if (i === goal.i && j === goal.j) {
        end = k;
        break;
      }
      const steps: [number, number, number][] = [
        [i - 1, j, 0],
        [i + 1, j, 0],
        [i, j - 1, 1],
        [i, j + 1, 1],
      ];
      for (const [ni, nj, nd] of steps) {
        if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
        const a = { x: xs[i], y: ys[j] }, b = { x: xs[ni], y: ys[nj] };
        if (nd === 0 ? !free(a.y, a.x, b.x) : !freeDown(a.x, a.y, b.y)) continue;
        const cost = c + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + (nd !== d ? BEND : 0);
        const nk = key(ni, nj, nd);
        if (cost < (dist.get(nk) ?? Number.POSITIVE_INFINITY)) {
          dist.set(nk, cost);
          prev.set(nk, k);
          open.push([cost, ni, nj, nd]);
        }
      }
    }
    if (end < 0) return [p, { x: p.x, y: lanes[0] }, { x: q.x, y: lanes[0] }, q];
    const path: Point[] = [];
    for (let k: number | undefined = end; k !== undefined; k = prev.get(k)) {
      const cell = Math.floor(k / 2);
      path.push({ x: xs[Math.floor(cell / ys.length)], y: ys[cell % ys.length] });
    }
    return path.reverse();
  }
}

/** The same way, with each joint of two parts on one line kept as a bend of no length: so the parts alternate, level
 *  and upright, and `separate` can move each part on its own. */
function alternate(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const a = out.at(-2), b = out.at(-1);
    if (b && b.x === p.x && b.y === p.y) continue;
    if (a && b && ((a.y === b.y && b.y === p.y) || (a.x === b.x && b.x === p.x))) out.push({ ...b });
    out.push({ ...p });
  }
  return out;
}

/** Drop a point that repeats the one before it, or that does not turn. */
function tidy(points: Point[]): Point[] {
  const kept = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  return kept.filter((p, i) => i === 0 || i === kept.length - 1 || !((kept[i - 1].x === p.x && p.x === kept[i + 1].x) || (kept[i - 1].y === p.y && p.y === kept[i + 1].y)));
}

/** Two arrows can share a segment only at one end: the first segments out of the same start, or the last segments
 *  into the same end. */
export function mayShare(p: Point[], k: number, q: Point[], m: number): boolean {
  const same = (u: Point, v: Point) => u.x === v.x && u.y === v.y;
  if (k === 0 && m === 0 && same(p[0], q[0])) return true;
  return k === p.length - 2 && m === q.length - 2 && same(p[p.length - 1], q[q.length - 1]);
}

/**
 * Move the inner segments of each route aside, a track at a time, so that no two arrows run on one line: a
 * segment that lies on a segment of another arrow moves to the nearest track where it lies on none, and passes
 * through no node and no name. The first and the last segment stay: they hold the ends.
 */
function separate(routes: Point[][], obstacles: Rect[]): Point[][] {
  const out = routes.map((r) => r.map((p) => ({ ...p })));
  const offsets = [0];
  for (let d = TRACK; d <= 10 * TRACK; d += TRACK) offsets.push(d, -d);
  /** How many arrows the segment k lies on; with no way through a node or a name. */
  const clash = (ri: number, pts: Point[], k: number) => {
    const a = pts[k], b = pts[k + 1];
    if (obstacles.some((r) => crosses(a, b, r))) return Number.POSITIVE_INFINITY;
    let n = 0;
    for (let rj = 0; rj < out.length; rj++) {
      if (rj === ri) continue;
      const q = out[rj];
      for (let m = 0; m + 1 < q.length; m++) if (overlaps(a, b, q[m], q[m + 1]) && !mayShare(pts, k, q, m)) n++;
    }
    return n;
  };
  // A move takes a segment to a track where it lies on no other arrow, and does not make its two neighbours (which
  // it stretches) lie on more arrows than before; a later move frees the neighbours. Three rounds over all arrows.
  for (let pass = 0; pass < 3; pass++) {
    for (let ri = 0; ri < out.length; ri++) {
      for (let k = 1; k + 2 < out[ri].length; k++) {
        const pts = out[ri];
        if (pts[k].x === pts[k + 1].x && pts[k].y === pts[k + 1].y) continue;
        if (clash(ri, pts, k) === 0) continue;
        const level = pts[k].y === pts[k + 1].y;
        const before = [clash(ri, pts, k - 1), clash(ri, pts, k + 1)];
        const n = pts.length - 1;
        for (const d of offsets.slice(1)) {
          const cand = pts.map((p) => ({ ...p }));
          for (const j of [k, k + 1]) {
            if (level) cand[j].y += d;
            else cand[j].x += d;
          }
          // The first and the last segment keep their way out of the start and into the end.
          const firstOk = k > 1 || (Math.sign(cand[1].x - cand[0].x) === Math.sign(pts[1].x - pts[0].x) && Math.abs(cand[1].x - cand[0].x) >= TRACK);
          const lastOk = k + 1 < n - 1 || (Math.sign(cand[n].x - cand[n - 1].x) === Math.sign(pts[n].x - pts[n - 1].x) && Math.abs(cand[n].x - cand[n - 1].x) >= TRACK);
          if (!firstOk || !lastOk) continue;
          if (clash(ri, cand, k) !== 0) continue;
          if (clash(ri, cand, k - 1) > before[0] || clash(ri, cand, k + 1) > before[1]) continue;
          out[ri] = cand;
          break;
        }
      }
    }
  }
  return out;
}
