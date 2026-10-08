// Hinged sound box - parametric OpenSCAD model
// Exported from the Hinged Sound Box editor on 2026-10-08.
// Units: millimetres. Z is up. X runs left to right, Y runs front to back.
// Origin: outer front-left-bottom corner of base A.
// Edit the values below, or use Window > Customizer in OpenSCAD.

/* [Body] */
// Outer length, left to right
length = 260;
// Outer depth of the body, front to back (the lid adds the flap and clearance)
depth = 200;
// Closed height: base + walls + lid
height = 100;
// Board thickness
t = 5;

/* [Lid and flap] */
// Lid opening angle in degrees; 0 is closed
lid_angle = 95; // [0:1:180]
// Drop of the front flap under the lid
flap_height = 30;
// Gap between the flap and the fixed front wall (does not scale with the box)
flap_clearance = 1;

/* [Outlet and baffles] */
// Opening beside the front wall at the right-hand end
outlet_width = 40;
// Number of internal baffles
baffle_count = 5; // [0:1:20]
// Left face of baffle 1, measured from the inside face of the left end wall
baffle_offset = 30;
// Distance from one baffle's left face to the next
baffle_pitch = 40;
// Air gap at the free end of each baffle
baffle_gap = 40;
// Baffle 1 attaches to the back wall; the rest alternate
first_baffle_back = true;

/* [Display] */
show_front_wall = true;
show_lid = true;

/* [Hidden] */
shell_color = "#f1f0ea";
baffle_color = "#f1f0ea";
lid_color = "#f1f0ea";
board_alpha = 1;
baffle_colors = [];

inner_l = length - 2 * t;
inner_w = depth - 2 * t;
wall_h = height - 2 * t;
outlet_panel = inner_w - outlet_width;
baffle_len = inner_w - baffle_gap;
end_clear = inner_l - (baffle_offset + (baffle_count - 1) * baffle_pitch + t);

echo(str("Clear interior: ", inner_l, " x ", inner_w, " x ", wall_h, " mm"));
echo(str("Closed envelope: ", length, " x ", depth + t + flap_clearance, " x ", height, " mm"));
if (baffle_count > 0) echo(str("Clear past the last baffle: ", end_clear, " mm"));
if (wall_h <= 0) echo("WARNING: height must be more than two board thicknesses");
if (outlet_panel <= 0) echo("WARNING: outlet_width is as wide as the interior, so panel E is left out");
if (baffle_count > 0 && baffle_len <= 0) echo("WARNING: baffle_gap is as wide as the interior, so the baffles are left out");
if (baffle_count > 1 && baffle_pitch <= t) echo("WARNING: baffle_pitch is not larger than t, so the baffles overlap");
if (baffle_count > 0 && end_clear <= 0) echo("WARNING: the last baffle runs into the outlet end wall");

module board(c, pos, size) color(c, board_alpha) translate(pos) cube(size);

// A  Base: every upright panel sits on it
board(shell_color, [0, 0, 0], [length, depth, t]);

if (wall_h > 0) {
  // C1  Back wall, outside face flush with the base edge
  board(shell_color, [0, depth - t, t], [length, t, wall_h]);
  // C2  Front wall
  if (show_front_wall) board(shell_color, [0, 0, t], [length, t, wall_h]);
  // D  Closed end, between the long walls at the left
  board(shell_color, [0, t, t], [t, inner_w, wall_h]);
  // E  Outlet end panel: touches the back wall and leaves the outlet beside the front wall
  if (outlet_panel > 0) board(shell_color, [length - t, depth - t - outlet_panel, t], [t, outlet_panel, wall_h]);
  // F  Internal baffles, alternating back / front
  if (baffle_count > 0 && baffle_len > 0)
    for (i = [0 : baffle_count - 1]) {
      back = (i % 2 == 0) == first_baffle_back;
      board(i < len(baffle_colors) ? baffle_colors[i] : baffle_color,
            [t + baffle_offset + i * baffle_pitch, back ? depth - t - baffle_len : t, t],
            [t, baffle_len, wall_h]);
    }
}

// B  Lid and G front flap, hinged with tape on the outside top edge of the back wall
if (show_lid)
  translate([0, depth, height - t]) rotate([-lid_angle, 0, 0]) translate([0, -depth, -(height - t)]) {
    board(lid_color, [0, -(t + flap_clearance), height - t], [length, depth + t + flap_clearance, t]);
    if (flap_height > 0)
      board(lid_color, [0, -(t + flap_clearance), height - t - flap_height], [length, t, flap_height]);
  }
