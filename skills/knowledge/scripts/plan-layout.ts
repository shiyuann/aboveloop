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
 * - **No arrow runs through a node.** An arrow goes up or down only in the gap between two layers of a cell, or in
 *   the side padding of a band; it goes along a level only where no node is.
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
const LAYER_GAP = 44;
/** Between two nodes of a layer. */
const ROW_GAP = 16;
/** The side padding of a band: the arrows go up and down in it. */
const BAND_PAD = 22;
/** The empty space between two bands. */
const BAND_GAP = 24;
/** The width of a band with no node: room for its name. */
const EMPTY_BAND = 84;
/** Room above the cells for the names of the bands. */
export const BAND_HEAD = 30;
/** Inside a box: the padding, and the room for its two lines of name and state. */
const BOX_PAD = 10;
export const BOX_HEAD = 34;
/** Between two cells of a band. */
const CELL_GAP = 18;

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
 *  row pulled to the level of its neighbours. */
function layCell(codes: string[], edges: { from: string; to: string }[]): Pick<Cell, "at" | "width" | "height"> {
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
  const outer = (c: Cell) => ({ w: c.width + (c.group ? 2 * BOX_PAD : 0), h: c.height + (c.group ? BOX_HEAD + 2 * BOX_PAD : 0) });
  const bands: LayoutBand[] = [];
  let x = 0;
  stages.forEach((stage, i) => {
    const mine = cells.filter((c) => c.stage === i);
    const width = mine.length ? Math.max(...mine.map((c) => outer(c).w)) + 2 * BAND_PAD : EMPTY_BAND;
    if (i) x += BAND_GAP;
    bands.push({ stage, x, width, empty: mine.length === 0 });
    x += width;
  });
  // Stack the cells of each band.
  const bottom = stages.map(() => BAND_HEAD);
  const nodes: Record<string, Point> = {};
  const boxes: LayoutBox[] = [];
  const seenGroup = new Set<string>();
  for (const cell of cells) {
    const o = outer(cell);
    cell.x = bands[cell.stage].x + BAND_PAD;
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
  const width = x;
  const height = Math.max(BAND_HEAD, ...bottom) - CELL_GAP + 8;
  const route = router(cells, bands, nodes);
  const cellOf = new Map<string, Cell>();
  for (const cell of cells) for (const c of cell.codes) cellOf.set(c, cell);
  const all: LayoutEdge[] = [];
  const merged = new Map<string, LayoutEdge>();
  for (const e of input.edges) {
    const a = cellOf.get(e.from), b = cellOf.get(e.to);
    if (!a || !b || e.from === e.to) continue;
    const via = `${e.from}>${e.to}`;
    all.push({ from: e.from, to: e.to, via: [via], points: route(e.from, e.to) });
    // The ports: an arrow that leaves or enters a box ends at the box.
    const from = a.group && a !== b ? `${BOX_PREFIX}${a.id}` : e.from;
    const to = b.group && a !== b ? `${BOX_PREFIX}${b.id}` : e.to;
    const key = `${from}\u0000${to}`;
    const m = merged.get(key);
    if (m) m.via.push(via);
    else merged.set(key, { from, to, via: [via], points: route(from, to) });
  }
  return { node: { width: NODE_W, height: NODE_H }, bands, nodes, boxes, edges: [...merged.values()], all, width, height };
}

/** The routes: each one a list of points, from the right side of its start to the left side of its end. */
function router(cells: Cell[], bands: LayoutBand[], nodes: Record<string, Point>) {
  const rects = Object.values(nodes);
  /** No node on the level `y` between `xa` and `xb`. */
  const free = (y: number, xa: number, xb: number) =>
    !rects.some((r) => Math.max(xa, xb) > r.x + 1 && Math.min(xa, xb) < r.x + NODE_W - 1 && y > r.y + 1 && y < r.y + NODE_H - 1);
  /** No node on the line `x` between `ya` and `yb`. */
  const freeDown = (x: number, ya: number, yb: number) =>
    !rects.some((r) => x > r.x + 1 && x < r.x + NODE_W - 1 && Math.max(ya, yb) > r.y + 1 && Math.min(ya, yb) < r.y + NODE_H - 1);
  const cellOf = new Map<string, Cell>();
  for (const cell of cells) {
    for (const c of cell.codes) cellOf.set(c, cell);
    cellOf.set(`${BOX_PREFIX}${cell.id}`, cell);
  }
  /** The levels between cells, and above them all. */
  const lanes = [BAND_HEAD / 2, ...cells.flatMap((c) => [c.y - CELL_GAP / 2, c.y + c.outerH + CELL_GAP / 2])];
  const endOf = (code: string, side: "out" | "in"): Point => {
    const cell = cellOf.get(code) as Cell;
    if (code.startsWith(BOX_PREFIX)) return { x: side === "out" ? cell.x + cell.outerW : cell.x, y: cell.y + cell.outerH / 2 };
    const n = nodes[code];
    return { x: side === "out" ? n.x + NODE_W : n.x, y: n.y + NODE_H / 2 };
  };
  /** The way from an end to the side padding of its band at `pad`: points from the end outwards, and the level
   *  where it reaches the padding. */
  const leg = (code: string, end: Point, pad: number) => {
    if (free(end.y, end.x, pad)) return { points: [end], y: end.y };
    const cell = cellOf.get(code) as Cell;
    const jog = end.x + Math.sign(pad - end.x) * (LAYER_GAP / 2);
    const tries = [cell.y - CELL_GAP / 2, cell.y + cell.outerH + CELL_GAP / 2].sort((a, z) => Math.abs(a - end.y) - Math.abs(z - end.y));
    const y = tries.find((l) => freeDown(jog, end.y, l) && free(l, jog, pad)) ?? tries[0];
    return { points: [end, { x: jog, y: end.y }, { x: jog, y }], y };
  };
  const tidy = (points: Point[]) => {
    const kept = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    return kept.filter((p, i) => i === 0 || i === kept.length - 1 || !((kept[i - 1].x === p.x && p.x === kept[i + 1].x) || (kept[i - 1].y === p.y && p.y === kept[i + 1].y)));
  };
  return (from: string, to: string): Point[] => {
    const a = cellOf.get(from) as Cell, b = cellOf.get(to) as Cell;
    const s = endOf(from, "out"), t = endOf(to, "in");
    // In one cell, forwards: down or up in the layer gaps, along a free level between them.
    if (a === b && !from.startsWith(BOX_PREFIX) && !to.startsWith(BOX_PREFIX) && t.x > s.x) {
      const xs = s.x + LAYER_GAP / 2, xt = t.x - LAYER_GAP / 2;
      if (xs >= xt) return tidy([s, { x: xs, y: s.y }, { x: xs, y: t.y }, t]);
      const under = a.inner.y + a.height + (a.group ? BOX_PAD / 2 : CELL_GAP / 2);
      const over = a.group ? a.inner.y - BOX_PAD / 2 : a.y - CELL_GAP / 2;
      const y = [s.y, t.y, ...[under, over].sort((p, q) => Math.abs(p - s.y) - Math.abs(q - s.y))].find((l) => free(l, xs, xt) && freeDown(xs, s.y, l) && freeDown(xt, l, t.y)) ?? under;
      return tidy([s, { x: xs, y: s.y }, { x: xs, y }, { x: xt, y }, { x: xt, y: t.y }, t]);
    }
    // Between cells: out to the right padding of the band of the start, along a free level, down or up in the
    // left padding of the band of the end, and in.
    const outX = bands[a.stage].x + bands[a.stage].width - BAND_PAD / 2;
    const inX = bands[b.stage].x + BAND_PAD / 2;
    const out = leg(from, s, outX), into = leg(to, t, inX);
    const near = [...lanes].sort((p, q) => Math.abs(p - out.y) + Math.abs(p - into.y) - (Math.abs(q - out.y) + Math.abs(q - into.y)));
    const y = [out.y, into.y, ...near].find((l) => free(l, outX, inX)) ?? BAND_HEAD / 2;
    return tidy([...out.points, { x: outX, y: out.y }, { x: outX, y }, { x: inX, y }, { x: inX, y: into.y }, ...[...into.points].reverse()]);
  };
}
