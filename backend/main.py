import heapq
from fastapi import FastAPI, HTTPException, Query

app = FastAPI(title="Graph Search API")

GRAPH = [
    {
        "A": {"B", "C"},
        "B": {"A", "C", "D"},
        "C": {"A", "B", "D"},
        "D": {"B", "C", "E"},
        "E": {"D", "F"},
        "F": {"E", "G"},
        "G": {"F"},
    },
    {
        ("A", "B"): 1, ("B", "A"): 1,
        ("A", "C"): 4, ("C", "A"): 4,
        ("B", "C"): 2, ("C", "B"): 2,
        ("B", "D"): 5, ("D", "B"): 5,
        ("C", "D"): 1, ("D", "C"): 1,
        ("D", "E"): 3, ("E", "D"): 3,
        ("E", "F"): 2, ("F", "E"): 2,
        ("F", "G"): 2, ("G", "F"): 2,
    },
]


def heuristic(node, goal, graph) -> float:
    return 0.0
def generate_a_star(state, explored, graph):
   path = [state]
   cost = 0
   parent = state
   current = explored[parent][0]
   while current != "s":
      cost += graph[1][(current,parent)]
      path.append(current)
      parent = current
      current = explored[parent][0]
   return path[::-1], cost
def a_star(start, goal, graph, heuristic=heuristic): 
   if start not in graph[0]:
      raise HTTPException(status_code=404, detail=f"Node '{start}' not in graph")
   if goal not in graph[0]:
      raise HTTPException(status_code=404, detail=f"Node '{goal}' not in graph")
   h_start = heuristic(start,goal,graph)
   frontier, explored = [], {start: ("s",h_start)} # heuristic is total cost
   heapq.heappush(frontier,(h_start,0,start)) # total cost, cost to reach, state
   while len(frontier) > 0:
      tc,pc,s = heapq.heappop(frontier)
      if tc > explored[s][1]:
         continue
      if s == goal: 
         path, cost = generate_a_star(s, explored, graph)
         return path, cost
      for a in graph[0][s]:  #graph[3] is neighbors
         new_pc = pc + graph[1][(s,a)]
         new_tc = new_pc + heuristic(a,goal,graph)
         if a not in explored or new_tc < explored[a][1]:
            explored[a] = (s,new_tc)
            heapq.heappush(frontier,(new_tc,new_pc,a))
   return None
@app.get("/")
def root():
    return {"message": "Graph Search API", "routes": ["/search"]}


@app.get("/search")
def search(start: str = Query(...), goal: str = Query(...)):
    result = a_star(start, goal, GRAPH)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No path from '{start}' to '{goal}'")
    path, cost = result
    return {"start": start, "goal": goal, "path": path, "cost": cost}
