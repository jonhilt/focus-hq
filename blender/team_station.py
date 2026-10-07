"""A team station: where a goal's lead works with the captain, a small bridge in a holodeck. The lead sits in a command
chair facing a viewscreen in the holodeck's wall, with their helpers at consoles on two wings either side and the
goal's reviewer at tactical behind them, everyone turned to face the screen. The middle stays open: seated, the crew's
heads come up to about the captain's eyes, so anyone sitting between the lead and the screen would hide the lead's
latest output. The browser builds one for each of a holodeck's team stations (world/teamStation.ts) and draws the
lead's session on the viewscreen and the station's name and goal on the sign under it.

It's one module, built in its own frame: the lead's seat at the origin, the screen ahead (+Y) and the room behind
(-Y). Only the furniture is here: who sits where, and what the screens show, is the browser's.
"""

import math

from mathutils import Matrix, Vector

from kit import (COMMAND_RED, HULL, bezel, box, bridge_console, bridge_seat, command_chair, facing, marker, material,
                 module, panel, toon)

LEAD_SCALE = 0.85
#: the viewscreen: StationScreen's BIG_SCREEN proportions (1600×1024), its back as far ahead of the lead as the room puts
#: the holodeck's wall (world/teamStation.ts: STATION_SPOTS), its bottom over the lead's head from behind them
SCREEN_Y = 3.2
SCREEN_W = 2.5
SCREEN_H = SCREEN_W * 1024 / 1600
SCREEN_BOTTOM = 1.45
BEZEL = 0.12
#: the sign under it: lcarsSign's 1024×287, under the screen's starboard corner, where it shows from behind the lead
#: between their head and the nearest helper's
SIGN_W = 1.1
SIGN_H = SIGN_W * 287 / 1024
#: each wing runs forward and out from beside the lead, its seats this far apart, from the lead outwards in the order
#: helpers take them
WING_START = (1.05, 0.35)
WING_ANGLE = math.radians(32)
WING_STEP = 0.72
WINGS = {-1: ['station-helper-2', 'station-helper-4'], 1: ['station-helper-1', 'station-helper-3']}
#: tactical, behind the lead to port, as on the bridge
TACTICAL = (-1.2, -1.3)
#: how far ahead of a seat its console stands, as at conn and ops
REACH = 0.75


def build():
    module('team_station')
    command_chair('lead', (0, 0), 0, COMMAND_RED, LEAD_SCALE)
    marker('seat lead', 'seat', crew='station-lead')
    for side, crew in WINGS.items():
        wing(side, crew)
    station('station-reviewer', Vector(TACTICAL), 70)
    viewscreen()


def wing(side, crew):
    """Stations along a line forward and out from beside the lead on `side` (-1 port, 1 starboard)."""
    along = Vector((side * math.sin(WING_ANGLE), math.cos(WING_ANGLE)))
    for i, name in enumerate(crew):
        station(name, Vector((side * WING_START[0], WING_START[1])) + along * WING_STEP * i, 60 + 10 * side + i)


def station(crew, at, seed):
    """A seat at `at` for `crew`, at its own console, turned to face the middle of the screen."""
    seat = Matrix.Translation((at.x, at.y, 0)) @ Matrix.Rotation(facing(at, (0, SCREEN_Y)), 4, 'Z')
    # built with whoever sits at it on its +Y side, then turned to face them
    console = seat @ Matrix.Translation((0, REACH, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
    bridge_console(crew, 0.6, seed, console, display=(0.5, 0.3), accent=material(HULL['dado'], surface='accent'))
    bridge_seat(crew, seat)
    marker(f'seat {crew}', 'seat', frame=seat, crew=crew)


def viewscreen():
    """The screen in a bezel on the holodeck's wall, as the bridge's is, with the station's sign under it."""
    # facing the crew: its +Y is the module's -Y
    f = Matrix.Translation((0, SCREEN_Y, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
    trim = toon(HULL['frame'])
    middle = SCREEN_BOTTOM + SCREEN_H / 2
    bezel('viewscreen frame', SCREEN_W, SCREEN_H, 0.06, BEZEL, 0.1, trim, (0, 0, middle), f)
    # just in front of the bezel's back, so its rounded opening hides the screen's corners
    panel('viewscreen', SCREEN_W, SCREEN_H, material('#000000', surface='screen', outline=False, screen='team-station'), (0, 0.012, SCREEN_BOTTOM), f)
    under = SCREEN_BOTTOM - BEZEL - 0.1 - SIGN_H
    # its frame's edge in line with the bezel's (the frame turns the screen round, so starboard is -X)
    x = -(SCREEN_W / 2 + BEZEL - SIGN_W / 2 - 0.04)
    box('sign frame', (SIGN_W + 0.08, 0.05, SIGN_H + 0.08), toon(HULL['dado']), (x, 0.025, under - 0.04), frame=f, round=0.015)
    panel('sign', SIGN_W, SIGN_H, material('#000000', surface='screen', outline=False, screen='team-station-sign'), (x, 0.054, under), f)
