# Theater Panel

A wall-panel app for the home theater: browse Plex and play on the projector, request titles
through Seerr, run Music Assistant, and control the room's lights and scenes. It is built for a
1920x1080 Android panel running [Kiosk Satellite](../kiosk-satellite), and scales to fit any
other screen.

It runs as its own container, next to Plex and Seerr, so it adds no load to Home Assistant. HA
still does the room logic: every button calls a `theater_*` script from `ha/theater.yaml`, so
the same scenes work from Pico remotes, voice and the HA app.

```
Kiosk Satellite ──http──▶ theater-panel ──▶ Plex        (library, posters, sessions)
  (1920x1080 panel)         (this repo)  ──▶ Seerr       (search, requests, queue)
                                         ──▶ Home Assistant (one websocket, ~15 entities,
                                              theater_* scripts, Music Assistant actions)
```

## Screens

| Screen | What it does |
|---|---|
| **Home** | Continue watching (Plex on deck), scenes, projector power, lights, just added, music bar |
| **Watch** | Plex libraries as a poster grid with 4K / HDR / Atmos badges and filters (unwatched, under 2 hours, family friendly, 4K, HDR, random pick), browse by network (Netflix, Max, Prime Video…), details, subtitles, "ends at" time, Play on projector |
| **Request** | Seerr trending, upcoming (with release dates), what's streaming on each network, and search; request sheet (seasons, 1080p/4K), your request queue with download progress |
| **Games** | Console and PC buttons (HDMI switcher and projector input, through Home Assistant), Steam library with launch, gaming PC stats from HA |
| **Music** | Music Assistant now playing, albums/playlists/artists/radio, search, queue, which player to use |
| **Showtime** | The dark screen while something plays: pause, skip, volume, intermission, lights up. Opens by itself when the Apple TV starts playing and dims the panel's backlight through Kiosk Satellite. |

## Run it

```bash
cp .env.example .env    # fill in HA, Plex and Seerr
docker compose up -d
```

With Traefik, the panel is at `https://ht-kiosk.coulson.io` (set `PANEL_HOST`, `TRAEFIK_NETWORK`,
`TRAEFIK_ENTRYPOINT` and `TRAEFIK_CERTRESOLVER` in `.env` to match your Traefik). Without it,
open `http://<host>:8787`. Set that URL as Kiosk Satellite's start URL.

The live updates use Server-Sent Events, which Traefik passes through as-is; don't put a
buffering or compression middleware on this router.

For development without Docker: `npm install` and `npm run dev` (Node 22 or newer).

## Home Assistant setup

1. Copy `ha/theater.yaml` to `/config/packages/` (with `packages: !include_dir_named packages`
   under `homeassistant:`), then restart HA.
2. Create a long-lived access token, ideally for a dedicated non-admin user, and put it in `HA_TOKEN`.
3. For playback: in Plex on the Apple TV, turn on **Advertise as player**, open Plex, press
   **Scan clients** on the Plex integration, and set `ENTITY_PLEX_PLAYER` to the new entity.
4. Kiosk Satellite (fork build 2026.9.69-djc-2026.09.21.04 or later) opens a Home Assistant
   **Webpage dashboard** whose URL is this panel (https://ht-kiosk.coulson.io), with HA kiosk mode
   hiding the header and sidebar. Voice Satellite runs in the HA page around the panel. In KS,
   set **Page allowed from a frame** to exactly `https://ht-kiosk.coulson.io` so the HA page
   relays theater mode to the panel. `FRAME_ANCESTORS` must include HA's origin
   (`https://home-iot.coulson.io`), and Traefik must not add an `X-Frame-Options: DENY` header.

### Kiosk Satellite theater mode

Showtime turns Kiosk Satellite's theater mode on when it appears and off when it goes (through
the HA page's relay when framed, or the bridge directly when the panel is a top-level page): the
backlight drops to its minimum under a native black wash, the first touch only wakes the
screen (so a finger in the dark can't hit Stop), and a peek lasts 8 s after the last touch.
Announcements and camera popups still show. The app restores brightness itself, even after a
crash. If theater mode is switched on from elsewhere (HA's `switch.…_theater_mode`, a
`ks://theater` link, or a reload mid-film), the panel jumps to Showtime.

HA moves the panel between its screens with `rest_command.theater_panel_navigate` and
`route: "#/showtime"` (or `#/watch?brand=netflix`, `#/games`...), which pushes the route to every
open panel over its live connection; nothing reloads. (Kiosk Satellite's `navigate` service moves
the HA dashboard around the panel instead.)
In an ordinary browser there is no theater mode and Showtime simply dims its own controls.

## Games

Copy `config/games.example.json` to `config/games.json` (mounted read-only into the container).
Consoles behind the HDMI switcher are switched through its Home Assistant select entity, from
the [OREI HDMI switch integration](https://github.com/davidcoulson/ha-orei-ukm) for the UKM-401:
each source's `option` must match an input name set in that integration's options. Sources
wired straight to the projector (the Windows VM on HDMI 2) set `projectorInput` instead. Add the
PC's HA entities (power, stats sensors, and a script that launches a Steam game with `appid`)
under `pc`, and `STEAM_API_KEY` / `STEAM_ID` to `.env` for the library. The panel never talks to
the hardware itself; everything goes through Home Assistant.

Deep links work for everything, e.g. `#/watch?brand=netflix`, `#/request?mode=upcoming`,
`#/games`, which HA can send through Kiosk Satellite's navigate service.

## What is not finished

- **Projector input and picture mode.** Power works through the Apple TV (HDMI-CEC). Input and
  picture mode need the Aurora Pro's ADB commands, which have not been tested yet; the scripts
  post a notification instead of guessing. Set `ENTITY_PROJECTOR` once the ADB integration is set up.
- **Playback end to end.** The `theater_play_plex` script has not been run against the real Plex
  client entity yet (it is currently unavailable in HA).
- **Games hardware.** The HDMI switcher's serial commands, the projector input names and the
  Windows VM's HA entities are placeholders in `games.example.json` until they are known.
- **Music Assistant "Home Theater" player** is unavailable in HA, so the music bar shows that.
- Subtitles can be chosen before playing (stored on the Plex item). Changing them mid-movie
  is not possible through the Apple TV's HA integration.

## Layout

```
server/   Node http server, no framework: Plex, Seerr, HA websocket, image cache, SSE
web/      Preact + htm as plain ES modules (no build step), styles, room textures
ha/       Home Assistant package: scenes, play sequence, playback automation
tools/    shot.mjs (screenshots at 1920x1080 via local Chrome), textures.py (regenerates textures)
```

Dependencies: preact, htm and three @fontsource font packages. Fonts, textures and scripts are
all served locally, so the panel loads nothing from the internet.
