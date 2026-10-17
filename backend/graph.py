import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TILE2NET_REPO = BASE_DIR / "tile2net"
DEFAULT_OUTPUT = BASE_DIR / "t2n_output"


def generate_pedestrian_network(location, name, output_dir=DEFAULT_OUTPUT, zoom=None):
    out = Path(output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)

    gen_cmd = [
        sys.executable, "-m", "tile2net", "generate",
        "-l", location,
        "-n", name,
        "-o", str(out),
    ]
    if zoom is not None:
        gen_cmd += ["--zoom", str(zoom)]

    # No capture_output: Tile2Net's output prints straight to your terminal
    gen = subprocess.run(
        gen_cmd, cwd=TILE2NET_REPO, check=True, stdout=subprocess.PIPE, text=True
    )

    subprocess.run(
        [sys.executable, "-m", "tile2net", "inference"],
        cwd=TILE2NET_REPO,
        input=gen.stdout,
        check=True,
        text=True,
    )
    return out


if __name__ == "__main__":
    generate_pedestrian_network(
    location="42.3500, -71.0730, 42.3565, -71.0630",
    name="boston_common",
)