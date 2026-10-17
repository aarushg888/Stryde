"""Router-graph viewer (tkinter) for Stryde.

Inputs (JSON):
  adjacency.json   {"n0": ["n1", "n644"], ...}
  tubes.json       [["n0", "n1", 9.87], ...]            (edge weights, metres)
  tube_kind.json   [["n0", "n1", "crosswalk"], ...]     (edge kinds)
  meta.json        OPTIONAL; its "node_latlng" {"n0": [lat, lng], ...} gives
                   real positions. Without it, nodes are laid out with a
                   force-directed (spring) layout, which needs numpy.

Usage:
  python gui.py adjacency.json tubes.json tube_kind.json [meta.json]
  python gui.py data/router_graph          # folder holding those files
  python gui.py                            # file dialogs

Controls:
  mouse wheel  zoom at cursor        left-drag  pan
  click node   select it: shows neighbours, weights and kinds in the side panel
  Fit button   reset view            checkboxes toggle edge kinds / nodes / ids
"""
import json
import math
import os
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

KIND_COLORS = {
    "crosswalk": "#e63946",
    "sidewalk": "#2a9d8f",
    "curb_ramp": "#f4a261",
    "road": "#6c757d",
    "unknown": "#999999",
}
FALLBACK = ["#457b9d", "#8338ec", "#fb5607", "#3a86ff", "#06d6a0", "#ff006e"]
NODE_COLOR = "#264653"


# ------------------------------------------------------------------ data
def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def ekey(a, b):
    return (a, b) if a <= b else (b, a)


def build_graph(adjacency, tubes, tube_kinds):
    """-> nodes(set), edges{(a,b): {"w": float|None, "kind": str}}, nbrs{n: set}"""
    edges = {}

    def edge(a, b):
        return edges.setdefault(ekey(a, b), {"w": None, "kind": "unknown"})

    nodes = set()
    for a, nbrs in adjacency.items():
        nodes.add(a)
        for b in nbrs:
            nodes.add(b)
            edge(a, b)
    for row in tubes:
        a, b, w = row[0], row[1], row[2]
        nodes.update((a, b))
        edge(a, b)["w"] = w
    for row in tube_kinds:
        a, b, k = row[0], row[1], row[2]
        nodes.update((a, b))
        edge(a, b)["kind"] = str(k)

    nbrs = {n: set() for n in nodes}
    for a, b in edges:
        nbrs[a].add(b)
        nbrs[b].add(a)
    return nodes, edges, nbrs


def spring_layout(nodes, nbrs, iterations=100, progress=None):
    """Fruchterman-Reingold per connected component, components packed in rows.

    Returns {node: (x, y)}. Requires numpy.
    """
    import numpy as np

    # connected components
    seen, comps = set(), []
    for n in nodes:
        if n in seen:
            continue
        comp, stack = [], [n]
        seen.add(n)
        while stack:
            u = stack.pop()
            comp.append(u)
            for v in nbrs[u]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        comps.append(comp)
    comps.sort(key=len, reverse=True)

    rng = np.random.default_rng(0)
    laid = []  # (comp, coords normalised to start at 0,0, w, h)
    for ci, comp in enumerate(comps):
        n = len(comp)
        if progress:
            progress(f"layout: component {ci + 1}/{len(comps)} ({n} nodes)")
        if n == 1:
            laid.append((comp, np.zeros((1, 2)), 0.0, 0.0))
            continue
        if n == 2:
            laid.append((comp, np.array([[0.0, 0.0], [1.0, 0.0]]), 1.0, 0.0))
            continue
        idx = {u: i for i, u in enumerate(comp)}
        eu, ev = [], []
        for u in comp:
            for v in nbrs[u]:
                if idx[u] < idx[v]:
                    eu.append(idx[u])
                    ev.append(idx[v])
        eu, ev = np.array(eu), np.array(ev)
        pos = (rng.random((n, 2)) * math.sqrt(n)).astype(np.float32)
        t = math.sqrt(n) / 5
        dt = t / (iterations + 1)
        chunk = max(1, 4_000_000 // n)
        for it in range(iterations):
            disp = np.zeros_like(pos)
            for i in range(0, n, chunk):
                d = pos[i:i + chunk, None, :] - pos[None, :, :]
                dist2 = (d * d).sum(-1) + 0.01
                disp[i:i + chunk] = (d / dist2[..., None]).sum(1)
            delta = pos[eu] - pos[ev]
            dist = np.sqrt((delta * delta).sum(1)) + 1e-6
            pull = delta * dist[:, None]
            np.add.at(disp, eu, -pull)
            np.add.at(disp, ev, pull)
            length = np.sqrt((disp * disp).sum(1)) + 1e-6
            pos += disp / length[:, None] * np.minimum(length, t)[:, None]
            t -= dt
            if progress and it % 10 == 0:
                progress(f"layout: component {ci + 1}/{len(comps)} "
                         f"({n} nodes) iteration {it}/{iterations}")
        pos = pos - pos.min(0)
        laid.append((comp, pos, float(pos[:, 0].max()), float(pos[:, 1].max())))

    # shelf-pack the components
    area = sum(max(w, 1.0) * max(h, 1.0) for _, _, w, h in laid)
    max_w = max(math.sqrt(area) * 1.6, laid[0][2])
    gap = 2.0
    x = y = row_h = 0.0
    out = {}
    for comp, pos, w, h in laid:
        if x > 0 and x + w > max_w:
            x, y, row_h = 0.0, y + row_h + gap, 0.0
        for u, p in zip(comp, pos):
            out[u] = (x + float(p[0]), y + float(p[1]))
        x += w + gap
        row_h = max(row_h, h)
    return out


# ------------------------------------------------------------------- GUI
class GraphViewer(tk.Tk):
    def __init__(self, paths=None):
        super().__init__()
        self.title("Stryde router graph viewer")
        self.geometry("1200x800")

        self.nodes, self.edges, self.nbrs = set(), {}, {}
        self.pos = {}            # node -> (x, y) world coords, y points down
        self.geo = False         # True when positions come from lat/lng
        self.lat0 = self.lng0 = 0.0
        self.cos0 = 1.0
        self.scale, self.ox, self.oy = 1.0, 0.0, 0.0
        self.kind_colors, self.kind_vars, self.kind_counts = {}, {}, {}
        self.selected = None
        self._drag = None
        self._moved = False

        self._build_ui()
        if paths:
            self.after(50, lambda: self.load(*paths))
        else:
            self.after(100, self.open_dialog)

    def _build_ui(self):
        top = ttk.Frame(self, padding=4)
        top.pack(side="top", fill="x")
        ttk.Button(top, text="Open…", command=self.open_dialog).pack(side="left")
        ttk.Button(top, text="Fit", command=self.fit).pack(side="left", padx=4)
        self.title_lbl = ttk.Label(top, text="no graph loaded")
        self.title_lbl.pack(side="left", padx=10)

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True)

        side = ttk.Frame(body)
        side.pack(side="left", fill="y", padx=4, pady=4)
        self.legend = ttk.LabelFrame(side, text="Edge kinds", padding=6)
        self.legend.pack(fill="x")
        opts = ttk.LabelFrame(side, text="Show", padding=6)
        opts.pack(fill="x", pady=6)
        self.show_nodes = tk.BooleanVar(value=True)
        self.show_ids = tk.BooleanVar(value=False)
        ttk.Checkbutton(opts, text="nodes", variable=self.show_nodes,
                        command=self.redraw).pack(anchor="w")
        ttk.Checkbutton(opts, text="node ids (when ≤300 visible)",
                        variable=self.show_ids, command=self.redraw).pack(anchor="w")
        info = ttk.LabelFrame(side, text="Selected node", padding=6)
        info.pack(fill="both", expand=True)
        self.info = tk.Text(info, width=34, height=16, state="disabled",
                            font=("TkFixedFont", 9), wrap="none")
        self.info.pack(fill="both", expand=True)

        self.canvas = tk.Canvas(body, bg="#fafafa", highlightthickness=0)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.status = ttk.Label(self, text="", anchor="w", padding=4)
        self.status.pack(side="bottom", fill="x")

        c = self.canvas
        c.bind("<Configure>", lambda e: self.redraw())
        c.bind("<ButtonPress-1>", self._press)
        c.bind("<B1-Motion>", self._motion)
        c.bind("<ButtonRelease-1>", self._release)
        c.bind("<Motion>", self._hover)
        c.bind("<MouseWheel>", lambda e: self._zoom(e.x, e.y, 1.15 if e.delta > 0 else 1 / 1.15))
        c.bind("<Button-4>", lambda e: self._zoom(e.x, e.y, 1.15))
        c.bind("<Button-5>", lambda e: self._zoom(e.x, e.y, 1 / 1.15))

    # --------------------------------------------------------------- load
    def open_dialog(self):
        ft = [("JSON", "*.json"), ("All files", "*.*")]
        paths = []
        for label in ("adjacency.json", "tubes.json", "tube_kind.json"):
            p = filedialog.askopenfilename(title=f"Select {label}", filetypes=ft)
            if not p:
                return
            paths.append(p)
        meta = filedialog.askopenfilename(
            title="Select meta.json (optional — Cancel to auto-layout)", filetypes=ft)
        self.load(*paths, meta or None)

    def load(self, adj_path, tubes_path, kinds_path, meta_path=None):
        try:
            adjacency = load_json(adj_path)
            tubes = load_json(tubes_path)
            kinds = load_json(kinds_path)
            meta = load_json(meta_path) if meta_path else {}
            if not isinstance(adjacency, dict):
                raise ValueError("adjacency file must be a JSON object {node: [neighbours]}")
            if not isinstance(tubes, list) or not isinstance(kinds, list):
                raise ValueError("tubes / tube_kind files must be JSON lists of [a, b, value]")
            self.nodes, self.edges, self.nbrs = build_graph(adjacency, tubes, kinds)
        except Exception as e:
            messagebox.showerror("Error", f"Could not load graph:\n{e}")
            return

        latlng = meta.get("node_latlng") or {}
        latlng = {n: v for n, v in latlng.items() if n in self.nodes}
        if latlng:
            self.geo = True
            lats = [v[0] for v in latlng.values()]
            lngs = [v[1] for v in latlng.values()]
            self.lat0 = (min(lats) + max(lats)) / 2
            self.lng0 = (min(lngs) + max(lngs)) / 2
            self.cos0 = math.cos(math.radians(self.lat0))
            self.pos = {n: ((v[1] - self.lng0) * self.cos0, -(v[0] - self.lat0))
                        for n, v in latlng.items()}
            how = f"lat/lng for {len(latlng)}/{len(self.nodes)} nodes"
        else:
            self.geo = False
            try:
                self.pos = spring_layout(
                    self.nodes, self.nbrs,
                    progress=lambda s: (self.status.config(text=s), self.update()))
            except ImportError:
                messagebox.showerror(
                    "numpy missing",
                    "No node coordinates were given (meta.json with node_latlng), "
                    "so a spring layout is needed, which requires numpy:\n\n"
                    "    pip install numpy")
                return
            how = "spring layout (no node_latlng)"

        self.selected = None
        self._set_info("")
        self.kind_counts = {}
        for e in self.edges.values():
            self.kind_counts[e["kind"]] = self.kind_counts.get(e["kind"], 0) + 1
        self._build_legend()
        missing = sum(1 for n in self.nodes if n not in self.pos)
        self.title_lbl.config(
            text=f"{len(self.nodes)} nodes, {len(self.edges)} edges — {how}"
                 + (f" — {missing} nodes without position (not drawn)" if missing else ""))
        self.update_idletasks()
        self.fit()

    def _build_legend(self):
        for w in self.legend.winfo_children():
            w.destroy()
        self.kind_vars.clear()
        self.kind_colors.clear()
        fb = iter(FALLBACK * 10)
        for kind in sorted(self.kind_counts):
            self.kind_colors[kind] = KIND_COLORS.get(kind) or next(fb)
            var = tk.BooleanVar(value=True)
            self.kind_vars[kind] = var
            row = ttk.Frame(self.legend)
            row.pack(anchor="w", pady=1)
            tk.Label(row, bg=self.kind_colors[kind], width=2).pack(side="left", padx=(0, 4))
            ttk.Checkbutton(row, text=f"{kind} ({self.kind_counts[kind]})",
                            variable=var, command=self.redraw).pack(side="left")

    # --------------------------------------------------------- transforms
    def _to_screen(self, p):
        return p[0] * self.scale + self.ox, p[1] * self.scale + self.oy

    def _to_world(self, sx, sy):
        return (sx - self.ox) / self.scale, (sy - self.oy) / self.scale

    def fit(self):
        if not self.pos:
            return
        xs = [p[0] for p in self.pos.values()]
        ys = [p[1] for p in self.pos.values()]
        w = max(self.canvas.winfo_width(), 100)
        h = max(self.canvas.winfo_height(), 100)
        dx = (max(xs) - min(xs)) or 1e-9
        dy = (max(ys) - min(ys)) or 1e-9
        pad = 40
        self.scale = min((w - 2 * pad) / dx, (h - 2 * pad) / dy)
        self.ox = w / 2 - (max(xs) + min(xs)) / 2 * self.scale
        self.oy = h / 2 - (max(ys) + min(ys)) / 2 * self.scale
        self.redraw()

    # ------------------------------------------------------------ drawing
    def redraw(self):
        c = self.canvas
        c.delete("all")
        if not self.pos:
            return
        W, H = c.winfo_width(), c.winfo_height()
        sp = {n: self._to_screen(p) for n, p in self.pos.items()}

        def on_screen(p):
            return -20 <= p[0] <= W + 20 and -20 <= p[1] <= H + 20

        for (a, b), e in self.edges.items():
            if a not in sp or b not in sp:
                continue
            var = self.kind_vars.get(e["kind"])
            if var is not None and not var.get():
                continue
            pa, pb = sp[a], sp[b]
            if not (on_screen(pa) or on_screen(pb)):
                continue
            c.create_line(pa[0], pa[1], pb[0], pb[1],
                          fill=self.kind_colors.get(e["kind"], "#333"), width=2)

        visible = [n for n, p in sp.items() if on_screen(p)]
        if self.show_nodes.get():
            for n in visible:
                x, y = sp[n]
                c.create_oval(x - 2, y - 2, x + 2, y + 2, fill=NODE_COLOR, outline="")
        if self.show_ids.get() and len(visible) <= 300:
            for n in visible:
                c.create_text(sp[n][0] + 4, sp[n][1] - 6, text=n, anchor="w",
                              font=("TkDefaultFont", 8), fill="#111")

        if self.selected in sp:
            s = self.selected
            for nb in self.nbrs.get(s, ()):
                if nb in sp:
                    c.create_line(*sp[s], *sp[nb], fill="#ffb703", width=4)
                    x, y = sp[nb]
                    c.create_oval(x - 5, y - 5, x + 5, y + 5, fill="#ffb703", outline="#222")
            x, y = sp[s]
            c.create_oval(x - 7, y - 7, x + 7, y + 7, fill="#d00000", outline="#222", width=2)
        if self.geo:
            self._draw_scale_bar(H)

    def _draw_scale_bar(self, H):
        """Scale bar in metres (111,320 m per degree of latitude)."""
        m_per_px = 111_320.0 / self.scale
        target = m_per_px * 120
        mag = 10 ** math.floor(math.log10(target))
        nice = next(m * mag for m in (1, 2, 5, 10) if m * mag >= target * 0.6)
        px = nice / m_per_px
        self.canvas.create_line(20, H - 20, 20 + px, H - 20, width=3, fill="#222")
        self.canvas.create_text(20, H - 30, anchor="w", fill="#222",
                                text=f"{nice:g} m" if nice < 1000 else f"{nice / 1000:g} km")

    # ------------------------------------------------------- interaction
    def _nearest(self, sx, sy, radius=12):
        best, best_d = None, radius * radius
        for n, p in self.pos.items():
            x, y = self._to_screen(p)
            d = (x - sx) ** 2 + (y - sy) ** 2
            if d <= best_d:
                best, best_d = n, d
        return best

    def _press(self, e):
        self._drag = (e.x, e.y)
        self._moved = False

    def _motion(self, e):
        if self._drag:
            dx, dy = e.x - self._drag[0], e.y - self._drag[1]
            if abs(dx) + abs(dy) > 0:
                self._moved = True
            self.ox += dx
            self.oy += dy
            self._drag = (e.x, e.y)
            self.redraw()

    def _release(self, e):
        self._drag = None
        if not self._moved and self.pos:
            self.selected = self._nearest(e.x, e.y)
            self._show_selected()
            self.redraw()

    def _hover(self, e):
        if not self.pos:
            return
        n = self._nearest(e.x, e.y)
        wx, wy = self._to_world(e.x, e.y)
        if self.geo:
            pos = f"lat {self.lat0 - wy:.6f}  lng {self.lng0 + wx / self.cos0:.6f}"
        else:
            pos = f"x {wx:.2f}  y {wy:.2f}"
        self.status.config(text=pos + (f"   |   node {n}" if n else ""))

    def _zoom(self, sx, sy, f):
        self.ox = sx - (sx - self.ox) * f
        self.oy = sy - (sy - self.oy) * f
        self.scale *= f
        self.redraw()

    def _set_info(self, text):
        self.info.config(state="normal")
        self.info.delete("1.0", "end")
        self.info.insert("end", text)
        self.info.config(state="disabled")

    def _show_selected(self):
        n = self.selected
        if n is None:
            self._set_info("")
            return
        lines = [f"{n}   degree {len(self.nbrs.get(n, ()))}"]
        if self.geo and n in self.pos:
            x, y = self.pos[n]
            lines.append(f"lat {self.lat0 - y:.6f}\nlng {self.lng0 + x / self.cos0:.6f}")
        lines.append("")
        for nb in sorted(self.nbrs.get(n, ())):
            e = self.edges[ekey(n, nb)]
            w = f"{e['w']:.2f}" if isinstance(e["w"], (int, float)) else "?"
            lines.append(f"{nb:<8} {w:>8}  {e['kind']}")
        self._set_info("\n".join(lines))


# ------------------------------------------------------------------ main
def resolve_args(argv):
    if len(argv) == 1 and os.path.isdir(argv[0]):
        d = argv[0]

        def find(*names):
            for nm in names:
                p = os.path.join(d, nm)
                if os.path.exists(p):
                    return p
            return None

        adj = find("adjacency.json", "adjacencies.json")
        tubes = find("tubes.json")
        kinds = find("tube_kind.json", "tube_kinds.json")
        if not (adj and tubes and kinds):
            sys.exit(f"{d} must contain adjacency.json, tubes.json and tube_kind.json")
        return adj, tubes, kinds, find("meta.json")
    if len(argv) >= 3:
        return argv[0], argv[1], argv[2], (argv[3] if len(argv) > 3 else None)
    if argv:
        sys.exit(__doc__)
    return None


if __name__ == "__main__":
    GraphViewer(resolve_args(sys.argv[1:])).mainloop()