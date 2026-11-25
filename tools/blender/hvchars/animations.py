"""The 14 scripted keyframe clips (build plan M07, GDD §7.2) for the shared rig.

Rotations are Euler degrees about the armature axes, relative to the parent, as if the bone
were at rest (``hvkit.blender.rig`` converts them to bone space). With the character facing
-Y, its left at +X and Z up:

- ``spine``/``head`` (pointing up): +X leans/nods forward, +Y tilts to the character's left,
  +Z turns to its left.
- arms (hanging down): ``fwd`` raises the arm forward, ``out`` raises it sideways, ``yaw``
  swings a forward arm outwards; ``elbow`` bends the forearm forward and ``bend_in`` curls a
  raised forearm towards the head.
- legs: ``fwd`` swings the thigh forward, ``knee`` bends the shin back, ``toe`` points the
  foot down.
- ``hips`` also takes a location offset (metres, armature axes): the bob of a step, a jump,
  the drop onto a seat.

Helpers are authored for the left side and mirrored (rotations about Y and Z flip sign).
Clips run at 24 fps; looping clips end on their first key.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from hvkit.character import ANIMATION_NAMES, BONE_NAMES, BonePose, Clip, Pose, Rot

Keys = Dict[str, BonePose]


def _side(side: str) -> float:
    return 1.0 if side == "l" else -1.0


def arm(side: str, fwd: float = 0.0, out: float = 0.0, yaw: float = 0.0, elbow: float = 0.0, bend_in: float = 0.0, wrist: float = 0.0) -> Keys:
    s = _side(side)
    return {
        f"upper_arm_{side}": BonePose((-fwd, -s * out, s * yaw)),
        f"forearm_{side}": BonePose((-elbow, -s * bend_in, 0.0)),
        f"hand_{side}": BonePose((-wrist, 0.0, 0.0)),
    }


def arms(**kw) -> Keys:
    return {**arm("l", **kw), **arm("r", **kw)}


def leg(side: str, fwd: float = 0.0, knee: float = 0.0, toe: float = 0.0, out: float = 0.0) -> Keys:
    s = _side(side)
    return {
        f"thigh_{side}": BonePose((-fwd, -s * out, 0.0)),
        f"shin_{side}": BonePose((knee, 0.0, 0.0)),
        f"foot_{side}": BonePose((toe, 0.0, 0.0)),
    }


def legs(**kw) -> Keys:
    return {**leg("l", **kw), **leg("r", **kw)}


def spine(lean: float = 0.0, tilt: float = 0.0, turn: float = 0.0) -> Keys:
    return {"spine": BonePose((lean, tilt, turn))}


def head(nod: float = 0.0, tilt: float = 0.0, turn: float = 0.0) -> Keys:
    return {"head": BonePose((nod, tilt, turn))}


def hips(z: float = 0.0, lean: float = 0.0, sway: float = 0.0, turn: float = 0.0, y: float = 0.0) -> Keys:
    return {"hips": BonePose((lean, sway, turn), (0.0, y, z))}


def tail(wag: float = 0.0, lift: float = 0.0) -> Keys:
    return {"tail": BonePose((-lift, 0.0, wag))}




def pose(*parts: Keys) -> Pose:
    """Merge partial poses (later ones win) over the rest pose, so every key sets every
    bone (clips never inherit a bone from the previous clip)."""
    out: Dict[str, BonePose] = {name: BonePose() for name in BONE_NAMES}
    for p in parts:
        out.update(p)
    return out


def clip(name: str, frames: int, loop: bool, keys: List[Tuple[int, Pose]], showcase: int = 0) -> Clip:
    if loop:
        keys = [k for k in keys if k[0] != frames] + [(frames, keys[0][1])]
    return Clip(name, frames, loop, tuple(keys), showcase)


RELAXED = arms(out=-6.0, elbow=6.0)


def idle() -> Clip:
    return clip("idle", 48, True, [
        (0, pose(RELAXED, tail(wag=-6))),
        (24, pose(arms(out=-8.0, elbow=10.0), spine(lean=2.5), head(nod=-3.0, tilt=2.0), hips(z=-0.004), tail(wag=6))),
    ], showcase=24)


def walk() -> Clip:
    def step(lead: str, trail: str, sign: float) -> Pose:
        return pose(
            leg(lead, fwd=26.0, knee=6.0, toe=-8.0), leg(trail, fwd=-20.0, knee=22.0, toe=10.0),
            arm(trail, fwd=22.0, elbow=18.0), arm(lead, fwd=-18.0, elbow=10.0),
            spine(lean=4.0, turn=sign * 5.0), hips(turn=-sign * 4.0), head(nod=-2.0), tail(wag=sign * 12.0),
        )

    def passing(support: str, swing: str, sign: float) -> Pose:
        return pose(
            leg(support, fwd=2.0, knee=2.0), leg(swing, fwd=8.0, knee=42.0, toe=6.0),
            arms(elbow=14.0), spine(lean=4.0), hips(z=0.018, sway=sign * 2.0), head(nod=-2.0), tail(wag=0.0, lift=6.0),
        )

    return clip("walk", 24, True, [
        (0, step("l", "r", 1.0)), (6, passing("l", "r", 1.0)), (12, step("r", "l", -1.0)), (18, passing("r", "l", -1.0)),
    ], showcase=0)


def run() -> Clip:
    def stride(lead: str, trail: str, sign: float) -> Pose:
        return pose(
            leg(lead, fwd=48.0, knee=28.0, toe=-10.0), leg(trail, fwd=-34.0, knee=60.0, toe=20.0),
            arm(trail, fwd=42.0, elbow=80.0), arm(lead, fwd=-32.0, elbow=70.0),
            spine(lean=14.0, turn=sign * 7.0), head(nod=-10.0), hips(turn=-sign * 5.0), tail(wag=sign * 16.0, lift=-10.0),
        )

    def flight(support: str, swing: str) -> Pose:
        return pose(
            leg(support, fwd=-6.0, knee=30.0), leg(swing, fwd=20.0, knee=80.0, toe=10.0),
            arms(fwd=4.0, elbow=78.0), spine(lean=14.0), head(nod=-10.0), hips(z=0.05), tail(lift=-14.0),
        )

    return clip("run", 16, True, [
        (0, stride("l", "r", 1.0)), (4, flight("l", "r")), (8, stride("r", "l", -1.0)), (12, flight("r", "l")),
    ], showcase=0)


SEATED = (legs(fwd=88.0, knee=88.0, toe=-4.0), hips(z=-0.13), arms(fwd=24.0, out=-4.0, elbow=38.0), tail(lift=-30.0))


def sit() -> Clip:
    return clip("sit", 48, True, [
        (0, pose(*SEATED)),
        (24, pose(*SEATED, spine(lean=3.0), head(nod=2.0, tilt=-3.0), hips(z=-0.133))),
    ], showcase=0)


def talk() -> Clip:
    return clip("talk", 36, True, [
        (0, pose(RELAXED)),
        (9, pose(arm("r", fwd=34.0, out=10.0, elbow=62.0, wrist=-10.0), arm("l", out=-6.0, elbow=8.0), head(nod=7.0), spine(turn=-4.0))),
        (18, pose(arm("r", fwd=22.0, out=6.0, elbow=46.0), arm("l", out=-6.0, elbow=8.0), head(nod=-3.0, tilt=5.0), spine(turn=-2.0))),
        (27, pose(arm("l", fwd=24.0, out=8.0, elbow=48.0), arm("r", out=-6.0, elbow=10.0), head(nod=5.0, tilt=-3.0), spine(turn=3.0))),
    ], showcase=9)


def wave() -> Clip:
    def up(sway: float) -> Pose:
        return pose(arm("r", out=128.0, fwd=8.0, elbow=10.0, bend_in=sway), arm("l", out=-6.0, elbow=8.0), head(tilt=-5.0 + sway * 0.1), spine(tilt=-3.0), tail(wag=sway * 0.6))

    return clip("wave", 32, True, [(0, up(20.0)), (8, up(-22.0)), (16, up(20.0)), (24, up(-22.0))], showcase=8)


HOLD_ROD = arms(fwd=40.0, out=-12.0, elbow=34.0)


def fish_cast() -> Clip:
    return clip("fish_cast", 36, False, [
        (0, pose(HOLD_ROD)),
        (12, pose(arms(fwd=150.0, out=-10.0, elbow=30.0), spine(lean=-10.0), head(nod=-8.0), hips(z=-0.01))),
        (18, pose(arms(fwd=78.0, out=-12.0, elbow=10.0), spine(lean=14.0), head(nod=6.0), leg("l", fwd=12.0, knee=8.0))),
        (28, pose(arms(fwd=48.0, out=-12.0, elbow=24.0), spine(lean=5.0), leg("l", fwd=6.0, knee=4.0))),
        (36, pose(HOLD_ROD)),
    ], showcase=12)


def fish_reel() -> Clip:
    def reel(rx: float, out: float) -> Pose:
        return pose(arm("l", fwd=42.0, out=-14.0, elbow=30.0), arm("r", fwd=38.0 + rx, out=-10.0 + out, elbow=48.0 - rx), spine(lean=-5.0), head(nod=4.0))

    return clip("fish_reel", 24, True, [(0, reel(8.0, 0.0)), (6, reel(0.0, 8.0)), (12, reel(-8.0, 0.0)), (18, reel(0.0, -8.0))], showcase=0)


def eat() -> Clip:
    def bite(nod: float, elbow: float) -> Pose:
        return pose(arm("r", fwd=56.0, out=-16.0, yaw=-10.0, elbow=elbow), arm("l", fwd=16.0, out=-10.0, elbow=58.0), head(nod=nod), tail(wag=nod))

    return clip("eat", 36, True, [(0, bite(0.0, 112.0)), (9, bite(7.0, 116.0)), (18, bite(0.0, 98.0)), (27, bite(7.0, 116.0))], showcase=9)


def cheer() -> Clip:
    up = arms(out=128.0, fwd=8.0, elbow=10.0)  # a V: straight up would vanish into big heads
    return clip("cheer", 24, True, [
        (0, pose(up, legs(knee=4.0))),
        (6, pose(arms(out=138.0, fwd=8.0, elbow=4.0, bend_in=-8.0), legs(fwd=20.0, knee=34.0, toe=16.0), hips(z=0.08), head(nod=-8.0), tail(wag=14.0, lift=10.0))),
        (12, pose(up, legs(fwd=12.0, knee=24.0), hips(z=-0.015), tail(wag=-10.0))),
        (18, pose(up, legs(knee=6.0), hips(z=0.0), head(nod=-4.0))),
    ], showcase=6)


def laugh() -> Clip:
    belly = arms(fwd=24.0, out=-10.0, elbow=72.0)
    return clip("laugh", 20, True, [
        (0, pose(belly, spine(lean=-9.0), head(nod=-12.0, tilt=3.0))),
        (5, pose(belly, spine(lean=-4.0), head(nod=-6.0, tilt=-2.0), hips(z=-0.012))),
        (10, pose(belly, spine(lean=-10.0), head(nod=-13.0, tilt=-4.0))),
        (15, pose(belly, spine(lean=-4.0), head(nod=-6.0, tilt=2.0), hips(z=-0.012))),
    ], showcase=0)


def heart() -> Clip:
    shape = arms(out=118.0, fwd=10.0, elbow=4.0, bend_in=78.0)  # forearms curl over the head
    return clip("heart", 40, False, [
        (0, pose(RELAXED)),
        (12, pose(shape, head(nod=-4.0), tail(wag=10.0))),
        (21, pose(shape, spine(tilt=4.0), head(nod=-4.0, tilt=6.0), tail(wag=-10.0))),
        (30, pose(shape, spine(tilt=-4.0), head(nod=-4.0, tilt=-6.0), tail(wag=10.0))),
        (40, pose(RELAXED)),
    ], showcase=21)


def think() -> Clip:
    def ponder(tilt: float, nod: float) -> Pose:
        return pose(arm("r", fwd=62.0, out=-14.0, yaw=-18.0, elbow=118.0, wrist=-20.0), arm("l", fwd=28.0, out=-20.0, yaw=-24.0, elbow=84.0), head(nod=nod, tilt=tilt), spine(tilt=-tilt * 0.3))

    return clip("think", 48, True, [(0, ponder(8.0, -6.0)), (24, ponder(13.0, -9.0))], showcase=24)


def clap() -> Clip:
    apart = arms(fwd=64.0, yaw=16.0, elbow=44.0)
    together = arms(fwd=66.0, yaw=-24.0, elbow=40.0)
    return clip("clap", 12, True, [(0, pose(apart, head(nod=2.0))), (6, pose(together, head(nod=-3.0), hips(z=-0.005)))], showcase=6)


CLIPS: Tuple[Clip, ...] = (idle(), walk(), run(), sit(), talk(), wave(), fish_cast(), fish_reel(), eat(), cheer(), laugh(), heart(), think(), clap())
assert tuple(c.name for c in CLIPS) == ANIMATION_NAMES


def get_clip(name: str) -> Clip:
    for c in CLIPS:
        if c.name == name:
            return c
    raise KeyError(f"unknown clip {name!r}")


__all__ = ["CLIPS", "get_clip", "arm", "arms", "leg", "legs", "spine", "head", "hips", "tail", "pose", "Rot"]
