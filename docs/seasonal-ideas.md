# Seasonal ideas: Thanksgiving and Christmas

Research only, nothing built. Effort S (under an hour), M (a few hours), L (a day or more, usually art generation).

## What Halloween is made of

| Layer | Where | Notes |
|---|---|---|
| Season/accent switch | `server/accents.mjs` (`ACCENTS`, `byCalendar`, `thanksgiving()`), `web/app.mjs` (`ACCENT_IDS`, `applyAccent` toggles `html.a-<id>`) | Accent sets `--gold`, rail glow, emblem, `weather` kind. |
| Shelf logic | `server/seasonal.mjs` (`SEASONS`, `seasonNow`, `seasonsNow`) | Only halloween and christmas shelves; Hallmark joins christmas. |
| Fx layer | `web/lib/halloween.mjs` (`HalloweenFx`), mounted only when the accent is halloween (`app.mjs:528`) | CSS fog + one roaming sprite at a time, random 20-50 s apart, 9 s stay. |
| Sprites | `tools/halloween-sprites.py` | AI sheet (3x2 or 4x3 cells on black) -> alpha from brightness -> `ATLAS=12` gives a 12x8 atlas, 2880x1920 (240 px frames, 96 frames, 12 fps). Stepped with two `background-position` keyframes (`hw-dance-x/-y`). |
| Header mascot | `styles.css:1025` `html.a-halloween header.top .right::before` | Pumpkin atlas as a pseudo-element at 120 px. |
| Rail emblem | `web/lib/emblems.mjs` | SVG per accent; halloween alone uses the sprite. |
| Weather | `web/lib/particles.mjs` (`KINDS`, canvas 20 fps) | Already has `leaves`, `xmas` (snow, sleigh, Santa, snowmen, `decor='tree'`). |
| Tie-ins | `web/lib/snacks.mjs` (`hat()` per accent), `web/views/showing.mjs` (creature card, `christmasCountdown`), `server/actions.mjs:325` (spooky preroll), `styles.css:809` (`.sh-board.halloween`) |

**Already done for the next two seasons** (so effort below is lower than it looks): both accents, gold colours, SVG emblems (turkey, Santa), `leaves` and `xmas` weather, Christmas tree decor on the idle board, Santa hats on the snack parade, the Christmas countdown (shown Nov 1 - Dec 25), Christmas and Hallmark shelves.

**Gaps and quirks found**
- `html.a-christmas` has no `--gold` rule in `styles.css:81-88`; it falls back to the base gold (`#E3A865`, same value). Fine, but add one before changing it.
- Date logic disagrees: accent Thanksgiving = Saturday before through the day (`tg-5..tg`), accent Christmas = Friday after to Dec 30; shelf `seasonNow` starts Christmas **on** Thanksgiving day and runs all of December including the 31st. Task window (Nov 2 - 27) is close to the accent window, so reuse `byCalendar` and make `seasonNow` call it. Nov 2 to the Saturday before is currently the plain `fall` accent, so extend Thanksgiving to start Nov 2 (`m === 11 && d <= tg`) if wanted.
- Thanksgiving has no shelf, no creature, no theming beyond gold, emblem and leaves.

## 1. Thanksgiving (Nov 2 - Thanksgiving, 4th Thursday)

**Dates (S):** in `byCalendar` change the thanksgiving test to `m === 11 && d <= tg`. Add a `thanksgiving` entry to `SEASONS` in `seasonal.mjs` and let `seasonNow` return it from Nov 1. `server/accents.mjs`, `server/seasonal.mjs`.

**Colour (S, low):** keep `#C8912E`; add `html.a-thanksgiving` warm-wood tint on `.sh-board`/`.tasterow.seasonal` copying the halloween rules at `styles.css:809-815` (amber title, cream shadow). `web/styles.css`.

| Idea | Effort | Impact | Files / notes |
|---|---|---|---|
| Header turkey, same slot as the pumpkin: generalise the `::before` rule to `html.a-<id> header.top .right::before` with a per-accent atlas. Reuse the SVG turkey art as a fallback. | M (needs one atlas) | High | `styles.css:1025`, `tools/halloween-sprites.py`, new `turkey-96-atlas.png`. |
| Richer leaves: 26 maple/oak shapes today are plain; add 2 leaf silhouettes and a gust (wind burst every ~40 s) | S | Medium | `particles.mjs` `KINDS.leaves`, drawing section. Canvas only, cheap. |
| Roaming creatures via `HalloweenFx` renamed to `SeasonFx` (kinds list per accent): **turkey** strutting across the floor (walk cycle, `hw-shamble`-style drift), **scarecrow** swaying in place, **squirrel** that scampers and stops (small, 160 px) | L (art) / S (code once SeasonFx exists) | High | `web/lib/halloween.mjs` -> `season.mjs`, `styles.css` creature block, tools script, `app.mjs:528`. |
| Snack parade: pilgrim hats and a turkey-leg or pie in hand instead of the Halloween bucket | S | Medium | `snacks.mjs` `hat()` and the bucket call at line 93. |
| Intermission: "gratitude" marquee line, rotating "Tonight we're thankful for..." text, cranberry/amber bulbs | S | Medium | `web/views/intermission.mjs` plus bulb colour var in CSS. |
| Showing board: "Thankful for: Movie Night" countdown to Thursday ("3 days to Thanksgiving") beside the clock | S | Medium | generalise `christmasCountdown` in `api.mjs:323`, `showing.mjs`. |
| Football-day / Macy's parade shelf: Thanksgiving movies (Planes Trains and Automobiles, Home for the Holidays, A Charlie Brown Thanksgiving) with `HONORARY_THANKSGIVING` list | S | High | `seasonal.mjs`, `server/index.mjs:513` season param whitelist, Kometa collection `/^thanksgiving\.?$/`. |
| Sound: warm pre-roll instead of `preroll.mp3` (Thanksgiving) | S | Low-Med | `actions.mjs:325` already picks `spookyUrl` for halloween; make it a map `{halloween, thanksgiving, christmas}` and add settings keys in `server/admin.mjs`. |

## 2. Christmas (Fri after Thanksgiving - Jan 1)

**Dates (S):** window already exists in `byCalendar` (to Dec 30, New Year on the 31st). Extend New Year to cover Jan 1, so the task's Jan 1 end works, and align `seasonNow` (it keeps `christmas` through Dec 31, so cap at 30).

**Colour (S):** keep gold; add a `--green: #4E7D3A` accent and use red/green for `.sh-board.christmas`, Hallmark ribbon, shelf headings. `styles.css`.

| Idea | Effort | Impact | Files / notes |
|---|---|---|---|
| Header mascot: a Santa/elf or lit gingerbread house in the pumpkin slot. | M | High | same generalised `::before` rule. |
| String lights along the header and rail edge: 14-bulb strip (like the intermission `.bulb` marquee) twinkling with CSS `opacity` steps only | S | High | reuse `.marquee .bulb` styles, new `.xm-lights` in `styles.css`, mount in `app.mjs`. |
| Ambient: snow already exists; add a **fireplace** corner flicker (fog-like radial gradients, 3 layers, opacity only) on the idle board and a soft Aurora fade | S | Medium | CSS only, like `.hw-fog`. |
| Roaming creatures (same `SeasonFx`): **elf** running across, **reindeer** trot (leaves a glitter trail), **snowman** waving, **Grinch** sneaking past with a sack (high comedy), **nutcracker** marching 4 s, **penguin** sliding on its belly. 12x8 atlas each (96 frames), ~3-5 MB PNG each, one at a time. | L | High | as above; keep Santa's sleigh from `particles.mjs`. |
| Snack parade already wears Santa hats; add scarves and a candy cane in the free hand | S | Medium | `snacks.mjs`. |
| Intermission: "hot cocoa break" theming, snowy marquee, bulbs red/green/white chase (`chase` keyframes at `styles.css:718`) | S | Medium | `intermission.mjs`, CSS. |
| **Advent calendar** on the idle board: 24 little doors, today's opens to a movie pick from the Christmas shelf ("Today's Advent film") | M | High, delightful | new `web/views/advent.mjs` or a board kind in `showing.mjs`, `server/seasonal.mjs` for a stable daily pick (seeded by date). |
| Countdown: exists (days to Christmas, Nov 1+). Add "24 Days of Christmas Movies" tonight-card and Christmas Eve/Day special board. | S | Medium | `api.mjs:323`, `showing.mjs`. |
| Sound: sleigh bells stinger on Santa pass, preroll jingle, intermission carols (muted by default). | S-M | Medium | `actions.mjs:325`, `web/assets/`, `server/admin.mjs`. Check the panel's autoplay rules first. |
| Lights tie-in: set the accent lights to **Fairytwinkle** (already the glow) and make Home Assistant scenes follow the season. | S | High | already wired through `glow`; verify in `server/hass.mjs`. |
| Hallmark shelf banner with the Lacey Chabert gag as a rotating "Hallmark Bingo" card (square clichés) | M | Fun | `seasonal.mjs` `hallmarkShelf`, new board. |

## Limits and hardware

- **8192 px texture limit:** the 12x8 atlas at 240 px is 2880x1920 (safe). Never go to 96 frames in a single row (the script's `ATLAS` option exists for this). 360 px frames give 4320x2880, still safe; 512 px frames give 6144x4096, still under, but see memory below.
- **Memory:** each 2880x1920 atlas decodes to about 22 MB of GPU memory (RGBA). The panel currently holds five Halloween atlases (~110 MB if all resident). Load one atlas per roaming kind lazily, drop it after the creature leaves, and ship `loading=lazy`-style: set `background-image` only while visible. Do not preload all.
- **Older panels:** no blur filters or transformed layers (they speckle). Canvas weather at 20 fps is OK; do not add a second canvas, extend the existing one. Stepped sprites and opacity-only fog are safe. Keep fog layers to 4 as in Halloween, and string lights as plain opacity keyframes.
- **Per-frame art:** AI sheets on black give alpha by brightness, so white-ish things (snowmen, snow, cream turkeys) will go semi-transparent. Generate on a dark-blue/green key or use `ALPHA_GAIN`/`FILL` (`halloween-sprites.py`) and check each sheet on a light wall; dark clothing needs `FILL=1`, as the zombie does.

## Recommended shortlist (impact per effort)

1. **Align season dates** (accents, `seasonNow`, countdown, Jan 1) in one pass: S, removes inconsistencies.
2. **Generalise `HalloweenFx` to `SeasonFx` and the pumpkin `::before` to a per-accent mascot**: M, unlocks everything else.
3. **String lights + fireplace glow (Christmas), amber board theme (Thanksgiving)**: S each, visible on every screen.
4. **Thanksgiving shelf, Thanksgiving countdown, per-season pre-roll**: S, mostly server config.
5. **Advent calendar board**: M, the most delightful use of the shelf.
6. **Roaming sprites**: turkey first (Thanksgiving ends first), then Grinch, elf/reindeer for Christmas: L, art-bound. Do these last.

## Suggested build order

1. Dates and shelf (items 1 and 4): ship before Nov 2.
2. `SeasonFx` refactor with Thanksgiving CSS-only effects (leaf gusts, amber theme, amber bulbs).
3. Turkey mascot atlas + turkey roamer (run `halloween-sprites.py` with `ATLAS=12`).
4. Christmas lights/fireplace and snack-parade extras, before Nov 28.
5. Mascot and roaming art for Christmas, then the advent calendar by Dec 1.

## Art generated (ChatGPT, 2026-10-31) - sheets are in the user's Chrome Downloads, not yet in web/assets/

Each creature is 8 sheets (`<name>-96-1..8.png`), 12 frames per sheet (4x3), 96 frames in all; sheets are 1448x1086 (cells about 362 px), black background. Slice with `GRID=4x3 ATLAS=12 tools/halloween-sprites.py <sheets comma-joined> web/assets/<name>-96-atlas.png 240` -> 12x8 atlas, 2880x1920, as Halloween. Nothing is wired into the panel yet.

| Files | Use | Notes |
|---|---|---|
| turkey | Thanksgiving mascot + roamer | sheets 1-2 downloads unconfirmed; bird faces front/3-4, not strictly right |
| tree | Christmas header mascot | body still, lights twinkle |
| elf | Christmas roamer | run in place, facing right |
| reindeer | Classic Christmas roamer | `reindeer-96-1 (1).png` may exist as a duplicate |
| thief | Classic Christmas roamer (generic grumpy green sneak) | |
| santa | Classic Christmas roamer | rebuilt with bright boots/belt (black fades out) |
| bear | Die Hard roamer: barefoot man in tank top carrying a giant teddy bear with a red bow | only sheet 1 checked |
| duct (+ `flame-96-1.png`, 3x2, 512 px cells, 6 flicker frames) | Die Hard roamer: head-on crawl in an air duct with a flip lighter | DECIDED (user, 2026-10-31): a framed "peek into the vent" card that pops up, not a free roamer. Each cell has its own steel-duct background, so slice with plain resize (no alpha-from-brightness) and lay `flame-96-1` over the lighter for the flicker; motion in the sheets is subtle |
| vent (5 of 8, 60 frames) | KEEP (user, 2026-10-31): Die Hard bottom-of-screen roamer, side view: a section of steel duct with the man crawling right inside it, lighter lit; slide it along the bottom edge. Cells are 362 px squares with the wide strip centred in them, so crop to the middle band before building the atlas | |

**Die Hard mode (wiring, later):** a "Christmas style" setting (Classic / Die Hard) in `server/admin.mjs` + `server/accents.mjs`; Die Hard swaps the roamers to bear + duct and shows speech bubbles (plain CSS text): "Yippee-ki-yay" (full phrase), "Welcome to the party, pal", "Now I have a machine gun. Ho ho ho", "Come out to the coast, we'll get together, have a few laughs", "Happy trails", "Shoot the glass". The Christmas shelf leads with the honorary films.
