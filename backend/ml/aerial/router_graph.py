"""Minimal loader for the router-team graph handoff.

    graphs = load("data/router_graph")
    adjacency  = graphs[0]   # {node: [neighbor, ...]}
    tube_weight = graphs[1]  # {(n1, n2): meters}
"""
import json
import pathlib

def load(out_dir):
    out_dir = pathlib.Path(out_dir)
    adj = {}
    for node, nbrs in json.load(open(out_dir / "adjacency.json")).items():
        adj[node] = list(nbrs)
    tubes = {}
    for a, b, w in json.load(open(out_dir / "tubes.json")):
        tubes[(a, b)] = float(w)
    tube_kind = {}
    for a, b, w in json.load(open(out_dir / "tube_kind.json")):
        tube_kind[(a, b)] = float(w)
    meta = json.load(open(out_dir / "meta.json"))
    return [adj, tubes, tube_kind], meta
