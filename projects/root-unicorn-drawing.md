# Root unicorn drawing

`root-unicorn-drawing.sb3` reproduces the visible Python program in the
provided screenshots with iRobot Root extension blocks. It starts at the green
flag and contains all visible instructions through the final `move(-20)`.

Before clicking the green flag, connect the robot from the orange connection
button in the iRobot Root category. Put a marker in the robot and provide enough
open drawing space.

## Conversion rules

- Python distances and radii are centimeters; extension blocks use millimeters,
  so values are multiplied by 10.
- Right/clockwise turns and arcs are positive.
- Left/counterclockwise turns and arcs are negative. For a left arc, both its
  angle and radius are negative, as required by the Root BLE protocol.
- `set_marker_and_eraser_up()` maps to the marker `up` setting.

Regenerate the project with:

```sh
node scripts/create-unicorn-project.mjs
```
