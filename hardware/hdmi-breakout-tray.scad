// Tray for the Teansic HDMI A male-to-female 19-pin breakout board (Amazon B0CKN298QF).
//
// The board passes HDMI straight through, so it hangs inline on a cable: the male plug goes into
// the device, a cable plugs into the female socket, and the two rows of 2.54 mm pins stay exposed
// on top for tapping CEC (pin 13) and ground (pin 17).
//
// It locates on the board's four mounting holes and snaps over the long edges. Both connector
// ends are open, so nothing fouls the plug bodies.
//
// Board, measured from the manufacturer's drawing:
//   27.97 x 29.58 mm, 1.56 mm FR4, mounting holes 21.72 mm apart across and 16.3 mm along,
//   about 3.1 mm in from the sides. Set hole_dia / hole_pitch_y if yours differ.
//   The connector bodies hang 1.8 mm below the board, so the board stands off the floor and the
//   floor is cut away under both connectors.
//
//   openscad -D 'part="tray"' -o hdmi-breakout-tray.stl hardware/hdmi-breakout-tray.scad
//   openscad -D 'part="lid"'  -o hdmi-breakout-lid.stl  hardware/hdmi-breakout-tray.scad

part = "tray";          // "tray", "lid" or "both" (side by side, to look at)

/* [Board] */
board_w      = 27.97;   // across, between the long edges
board_d      = 29.58;   // along the cable
board_t      = 1.56;    // measured
fit          = 0.35;    // slack around the board so it drops in

/* [Mounting holes] */
hole_pitch_x = 21.72;
hole_pitch_y = 16.30;
hole_dia     = 3.00;    // through the PCB
post_dia     = hole_dia - 0.25;

/* [Pins] */
// The two rows of header pins stand 8.19 mm above the board, so the walls stay well below them
// and nothing blocks a jumper going onto pin 13 (CEC) or 17 (ground).
pin_h        = 8.19;

/* [Connectors] */
conn_drop    = 1.8;     // how far the connector bodies hang below the board
conn_w       = 17.0;    // width of the cut-out under each connector
conn_d       = 8.0;     // how far it reaches in from each end

/* [Lid] */
// Head room over the board: soldered wires need little, a Dupont plug on the pins needs ~16 mm.
lid_inside_h = 12.0;
lid_t        = 1.6;
lid_skirt    = 5.0;     // how far the lid's skirt comes down the outside of the tray
catch_h      = 1.0;     // the bump on the tray the lid clips under
wire_slot_w  = 6.0;     // notch in the lid's end for the CEC and ground wires

/* [Tray] */
floor_t      = 2.0;     // under the board
stand_h      = 2.8;     // gap under the board: the connectors hang 1.8 mm below it
wall_t       = 2.0;
lip          = 1.0;     // how far the snap tabs reach over the board
tab_w        = 9.0;     // snap tab width
relief       = 1.2;     // slot beside each tab so it can flex
$fn          = 64;

cav_w = board_w + fit;          // cavity the board sits in
cav_d = board_d + fit;
wall_h = stand_h + board_t + lip + 0.6;

module posts() {
  for (x = [-1, 1], y = [-1, 1])
    translate([x * hole_pitch_x / 2, y * hole_pitch_y / 2, floor_t]) {
      cylinder(h = stand_h, d = post_dia + 1.6);                       // shoulder the board rests on
      translate([0, 0, stand_h]) cylinder(h = board_t + 0.8, d = post_dia);
      translate([0, 0, stand_h + board_t + 0.8]) cylinder(h = 0.6, d1 = post_dia, d2 = post_dia - 0.8);  // lead-in
    }
}

// One snap tab: a wedge on the inner face of a wall that the board clicks under.
module tab(side, y) {
  x = side * cav_w / 2;
  translate([x, y, floor_t + stand_h + board_t])
    rotate([90, 0, 0])
      linear_extrude(height = tab_w, center = true)
        polygon([[0, 0], [-side * lip, 0], [-side * lip, 0.7], [0, 1.8]]);
}

module tray() {
  difference() {
    union() {
      // floor
      translate([0, 0, floor_t / 2])
        cube([cav_w + 2 * wall_t, cav_d, floor_t], center = true);
      // the two long side walls (the connector ends stay open)
      for (side = [-1, 1])
        translate([side * (cav_w / 2 + wall_t / 2), 0, (floor_t + wall_h) / 2])
          cube([wall_t, cav_d, floor_t + wall_h], center = true);
    }
    // lighten the floor, and let the board's underside breathe
    translate([0, 0, -1]) cube([cav_w - 8, cav_d - 10, floor_t + 2], center = true);
    // clear the connector bodies hanging below the board, at both ends
    for (y = [-1, 1])
      translate([0, y * (cav_d / 2 - conn_d / 2 + 0.1), -1])
        cube([conn_w, conn_d, floor_t + 2], center = true);
    // slots beside each tab so the walls can flex
    for (side = [-1, 1], y = [-1, 1])
      translate([side * (cav_w / 2 + wall_t / 2), y * (tab_w / 2 + relief / 2 + 0.6), floor_t + wall_h / 2 + 1])
        cube([wall_t + 2, relief, wall_h], center = true);
  }
  posts();
  for (side = [-1, 1], y = [-1, 1]) tab(side, y * cav_d / 4.5);
  // catches the lid clips under, on the outside of both walls
  for (side = [-1, 1])
    translate([side * (cav_w / 2 + wall_t), 0, floor_t + wall_h - catch_h - 0.6])
      rotate([90, 0, 0])
        linear_extrude(height = cav_d * 0.7, center = true)
          polygon([[0, 0], [side * 0.9, catch_h / 2], [0, catch_h]]);
}

// Lid: a roof over the pins with a skirt down the outside of the tray walls, open at both
// connector ends, notched at one end for the wires leaving the pins. Everything is measured from
// the tray floor, so the skirt always meets the walls.
board_z   = floor_t + stand_h;              // underside of the board
roof_z    = board_z + board_t + lid_inside_h;
wall_top  = floor_t + wall_h;               // top of the tray walls
catch_z   = wall_top - catch_h - 0.6;       // the bump the lid clips under
overlap   = 4.0;                            // how far the skirt reaches past the catches

module lid() {
  out_w = cav_w + 2 * wall_t;
  skirt_in = out_w + 0.4;                   // inside of the skirt, a little proud of the tray
  skirt_out = skirt_in + 2 * lid_t;
  skirt_bottom = catch_z - overlap;
  difference() {
    union() {
      translate([0, 0, roof_z + lid_t / 2]) cube([skirt_out, cav_d, lid_t], center = true);
      for (side = [-1, 1])
        translate([side * (skirt_out / 2 - lid_t / 2), 0, (skirt_bottom + roof_z) / 2])
          cube([lid_t, cav_d, roof_z - skirt_bottom], center = true);
    }
    // groove that snaps over the tray's catches
    for (side = [-1, 1])
      translate([side * (skirt_in / 2), catch_z * 0, catch_z])
        rotate([90, 0, 0])
          linear_extrude(height = cav_d * 0.72, center = true)
            polygon([[0, -catch_h], [side * 1.2, 0], [0, catch_h]]);
    // wire notch at one end
    translate([0, -cav_d / 2, roof_z + lid_t / 2]) cube([wire_slot_w, 6, lid_t + 2], center = true);
    // ease the skirt's mouth so it slides on
    for (side = [-1, 1])
      translate([side * (skirt_in / 2 + lid_t / 2), 0, skirt_bottom])
        rotate([90, 0, 0])
          linear_extrude(height = cav_d + 2, center = true)
            polygon([[-side * lid_t, 0], [side * lid_t, 0], [side * lid_t, -1.2]]);
  }
}

module board_ghost() {  // just for looking at the fit
  %translate([0, 0, floor_t + stand_h]) cube([board_w, board_d, board_t], center = true);
}

if (part == "tray") tray();
else if (part == "lid") translate([0, 0, roof_z + lid_t]) rotate([180, 0, 0]) lid();   // printed roof-down
else { tray(); translate([0, 0, floor_t + stand_h + board_t]) lid(); }

// The walls must stay under the pins, or jumpers won't seat.
assert(lip + 0.6 < pin_h, "walls would foul the header pins");
