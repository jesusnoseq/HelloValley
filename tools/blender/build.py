"""HelloValley kit generator entry point.

Run inside Blender (headless):

    blender --background --factory-startup --python-exit-code 1 \\
        --python tools/blender/build.py -- --style europe --out packages/client/public/assets/kits

or through ``npm run assets:build -- --style europe``. ``--dry-run`` also works with a plain
Python interpreter (no Blender) and only prints what would be built. See README.md.
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from hvkit import cli  # noqa: E402
import hvmodules  # noqa: E402,F401  (registers every module)


def main(argv: list) -> int:
    ns = cli.parse_args(cli.script_args(argv) if "--" in argv else argv[1:])
    try:
        plan = cli.make_character_plan(ns) if ns.characters else cli.make_plan(ns)
    except (ValueError, KeyError, NotImplementedError) as err:
        print(f"[hvkit] {err}")
        return 2
    print(plan.describe())
    if ns.dry_run:
        return 0
    try:
        import bpy  # noqa: F401
    except ImportError:
        print("[hvkit] bpy is not available: run this script inside Blender (see tools/blender/README.md)")
        return 2
    if ns.characters:
        from hvkit.blender import characters

        return characters.render(plan) if plan.contact_sheet else characters.run(plan)
    if plan.contact_sheet:
        from hvkit.blender.contact import render

        return render(plan, plan.contact_sheet)
    from hvkit.blender.runner import run

    return run(plan)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
