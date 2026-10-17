import osmnx as ox
import pickle
import pathlib
from itertools import islice

ROOT = pathlib.Path(__file__).resolve().parent.parent
PICKLE_DIR = ROOT / "data" / "osm" / "pickle"
PICKLE_DIR.mkdir(parents=True, exist_ok=True)

ox.settings.useful_tags_way = list(set(
    ox.settings.useful_tags_way
    + ["footway", "sidewalk", "crossing", "path"]
))

G = ox.graph_from_place(
    "Washington, District of Columbia, USA",
    network_type="walk",
    custom_filter=(
        '["highway"~"footway|path|pedestrian|steps"]'
    ),
    simplify=False,
    retain_all=True
)
node_latlng = {}
adjacencies = {}
tubes = {}
tube_kind = {}
def classify_edge(data):
    footway = data.get("footway")
    path = data.get("path")

    if footway == "crossing" or path == "crossing":
        return "crossing"

    if footway == "sidewalk":
        return "sidewalk"
    return "unknown"
for node in G.nodes():
    node_latlng[node] = [G.nodes[node]["y"],G.nodes[node]["x"]] 
    neighbors = set(G.neighbors(node))
    adjacencies[node] = neighbors

    for neighbor in neighbors:
        edge_dict = G.get_edge_data(node, neighbor, key=0)
        print(edge_dict)
        length = edge_dict["length"]
        tubes[(neighbor,node)] = length
        tubes[(node,neighbor)] = length
        tube_kind[(neighbor,node)] = classify_edge(edge_dict)
        tube_kind[(node,neighbor)] = classify_edge(edge_dict)

print("Node_latlng:", dict(islice(node_latlng.items(), 5)))
print("Adj:", dict(islice(adjacencies.items(), 5)))
print("Tubes:", dict(islice(tubes.items(), 5)))
print("Tube_kind:", dict(islice(tube_kind.items(), 5)))
with open(PICKLE_DIR / "node_latlng.pkl", "wb") as file:
    pickle.dump(node_latlng, file)
with open(PICKLE_DIR / "adjacencies.pkl", "wb") as file:
    pickle.dump(adjacencies, file)
with open(PICKLE_DIR / "tubes.pkl", "wb") as file:
    pickle.dump(tubes, file)
with open(PICKLE_DIR / "tube_kind.pkl", "wb") as file:
    pickle.dump(tube_kind, file)
