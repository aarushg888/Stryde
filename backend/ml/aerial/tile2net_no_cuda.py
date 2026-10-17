#!/usr/bin/env python3
"""Experimental: run tile2net local inference WITHOUT NVIDIA CUDA.

monkeypatching

  * torch.cuda.*            -> shims (is_available/device_count/set_device,
                               memory stats, empty_cache, FloatTensor)
  * Tensor.cuda()/Module.cuda()/is_cuda -> route to the chosen device
  * torch.nn.parallel.DataParallel / DistributedDataParallel -> plain passthrough

Usage (must run in the tile2net venv):
  backend/tile2net/.venv/bin/python ml/aerial/tile2net_no_cuda.py \
      --city-info backend/tile2net/output/test_area/tiles/test_area_256_info.json \
      --device mps

Results are NOT upstream-validated; verify output polygons/network visually
before using them. Documented in ml/aerial/SETUP.md.
"""
from __future__ import annotations

import argparse
import sys
import types

import torch
import torch.nn as nn
import torch.nn.parallel as parallel


def patch_device(device: str) -> None:
    real_cuda = torch.cuda
    fake = types.ModuleType("torch.cuda_shim")
    fake.__dict__.update(
        is_available=lambda: True,
        device_count=lambda: 1,
        set_device=lambda *a, **k: None,
        get_device_name=lambda *a, **k: f"Mock-{device}",
        get_device_capability=lambda *a, **k: (7, 0),
        is_pseudo_device=lambda *a, **k: False,
        synchronize=lambda *a, **k: None,
        empty_cache=lambda *a, **k: None,
        reset_peak_memory_stats=lambda *a, **k: None,
        max_memory_allocated=lambda *a, **k: 0,
        max_memory_reserved=lambda *a, **k: 0,
        FloatTensor=torch.FloatTensor,
        device=lambda *a, **k: torch.device(device),
    )
    for name in dir(real_cuda):
        if not hasattr(fake, name):
            try:
                setattr(fake, name, getattr(real_cuda, name))
            except Exception:
                pass
    torch.cuda = fake

    torch.Tensor.cuda = lambda self, *a, **k: self.to(device)
    nn.Module.cuda = lambda self, device=None, **k: self.to(device)

    torch.Tensor.is_cuda = property(lambda self: True)

    class _PassthroughParallel(nn.Module):
        def __init__(self, module, **kwargs):
            super().__init__()
            self.module = module

        def forward(self, *args, **kwargs):
            return self.module(*args, **kwargs)

    parallel.DataParallel = _PassthroughParallel
    parallel.DistributedDataParallel = _PassthroughParallel


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--city-info", required=True, help="path to the <project>_info.json from tile2net generate")
    ap.add_argument("--device", default=None, choices=["mps", "cpu"],
                    help="device to run on; default: mps if available else cpu")
    ap.add_argument("--dump-percent", type=int, default=0,
                    help="percentage of segmentation PNGs to dump (vector outputs unaffected)")
    args = ap.parse_args()

    device = args.device or ("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"[no-cuda runner] device = {device}")

    patch_device(device)

    sys.argv = [
        "tile2net", "inference",
        "--local", "--eval", "test",
        "--city_info", args.city_info,
        "--dump_percent", str(args.dump_percent),
    ]
    import tile2net.__main__ as t2n_main
    t2n_main.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
