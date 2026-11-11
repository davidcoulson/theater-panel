# Projector launcher

Minimal Android TV home screen for the theater projector (NexiGo Aurora Pro, Android TV 9, 32-bit): clock, date,
weather (Open-Meteo, 44133), a switchable dark wallpaper (Up from the dock reaches the corner buttons: wallpaper and Android settings), and a dock with YouTube (SmartTube),
Plex (Plezy) and the inputs from this server's `/api/games` (Apple TV, Windows, the HDMI-switcher consoles). Picking an
input posts `game_source` to `/api/action`, so the server drives the switcher and projector through Home Assistant.

Pure Java, no native code (safe on the 32-bit projector). Build: `gradle assembleDebug` (needs `ANDROID_HOME`, JDK 17,
`local.properties` with `sdk.dir`). Install over ADB, then `cmd package set-home-activity io.coulson.tplauncher/.Main`.
The server address is `PANEL` in `Main.java`; if the projector isn't a trusted network, store the panel key in the app's
`tp` prefs as `key`. Icons in `res/drawable` are the panel's Iconify icons converted to vector drawables.
