"""Zero-dependency smoke tests for the Stryde MVP API.

Spawns uvicorn on a scratch port, drives it with urllib, prints PASS/FAIL.
Run:  backend/tile2net/.venv/bin/python backend/tests/test_api.py
"""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

PORT = 8199
BASE = f"http://127.0.0.1:{PORT}"
DEMO_START = "38.9131,-77.0305"
DEMO_GOAL = "38.9184,-77.0248"

failures = []


def check(name, condition, info=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" — {info}" if info and not condition else ""))
    if not condition:
        failures.append(name)


def get(path):
    try:
        with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def post_json(path, body):
    try:
        req = urllib.request.Request(
            f"{BASE}{path}", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def wait_healthy(timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            code, body = get("/health")
            if code == 200:
                return body
        except Exception:
            pass
        time.sleep(0.5)
    return None


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def main():
    env = dict(os.environ)
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1",
         "--port", str(PORT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
        cwd=REPO_ROOT, env=env)
    try:
        health = wait_healthy()
        check("health 200", health is not None and health.get("ok") is True, str(health))
        check("graph present", health and health.get("graph", {}).get("nodes", 0) > 100)
        check("coverage areas listed", health and "demo" in health.get("coverage", []))

        code, demo = get(f"/search?start={DEMO_START}&goal={DEMO_GOAL}")
        check("demo route 200", code == 200, str(demo)[:120])
        check("route geometry endpoints", demo["geometry"][0][0] == 38.9131
              and demo["geometry"][-1][0] == 38.9184)
        check("route has path + costs", len(demo["path"]) > 1 and demo["total_cut_m"] > 0)
        check("straight_m computed", demo.get("straight_m", 0) > 500)
        check("ratio 1..6", 1.0 < demo.get("ratio", -1) < 6.0, str(demo.get("ratio")))
        check("snap candidates tried", demo.get("snap_candidates_tried", 0) >= 1)

        code, bad = get("/search?start=n0&goal=n1000")
        check("cross-component 404 with guidance", code == 404 and "components" in bad.get("detail", ""))

        code, out = get("/search?start=38.99999,7&goal=38.9,77.0")
        check("far away -> 404 no node nearby", code == 404, f"{code} {out}")

        code, one = post_json("/incidents", {"type": "Sidewalk", "location": "38.9131,-77.0305"})
        check("incident POST 200", code == 200 and one.get("id", 0) > 0, f"{code} {one}")
        check("incident latlng parsed", one.get("latlng") == [38.9131, -77.0305], str(one.get("latlng")))
        code, listed = get("/incidents")
        check("incident GET lists newest first",
              code == 200 and listed["incidents"][0].get("id") == one["id"],
              str(listed)[:160])
        code, bad = post_json("/incidents", {"type": "", "location": "x"})
        check("incident validation 422", code == 422, str(code))

        code, nova = get("/coverage?area=nova")
        check("nova coverage 200", code == 200 and len(nova.get("geojson", {}).get("features", [])) > 100)

        code, idx = get("/")
        check("index lists routes", code == 200 and "/search" in idx.get("routes", []))
    finally:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"\n{len(failures)} failure(s): {failures}" if failures
          else "\nALL CHECKS PASSED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
