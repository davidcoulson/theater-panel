package com.davidcoulson.tplauncher;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.media.tv.TvContract;
import android.os.Bundle;
import android.os.Handler;
import android.view.*;
import android.widget.*;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Minimal dock-only home screen: wallpaper, clock/date/weather, and a row of fixed shortcuts. */
public class Main extends Activity {
    // name, kind (package or tv input id), icon
    static final String[][] APPS = {
        {"YouTube", "app:org.smarttube.stable", "yt"},
        {"Plex", "app:com.edde746.plezy", "plex"},
    };
    // Shown until the theater-panel server answers; then its input list (Apple TV, Windows, consoles) replaces them.
    static final String[][] FALLBACK = {
        {"HDMI 1", "tv:com.mediatek.tvinput/.hdmi.HDMIInputService/HW5", "hdmi"},
        {"HDMI 2", "tv:com.mediatek.tvinput/.hdmi.HDMIInputService/HW6", "hdmi"},
    };
    static final String PANEL = "http://10.2.6.45:8787"; // theater-panel server; add ?key= via prefs "key" if the projector isn't a trusted network
    LinearLayout dock, corner;
    LinearLayout media; FrameLayout roam; String armedKey = ""; long armedPlay = 0;
    String accent = "", cond = "", activeId = ""; int gold = 0xFFFFFFFF; long armed = 0;
    static final double LAT = 41.3136, LON = -81.7240; // 44133 North Royalton, OH
    ImageView wall; TextView time, date, wx; String[] walls; int wallIdx;
    SharedPreferences prefs; final Handler h = new Handler();

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("tp", MODE_PRIVATE);
        try { walls = getAssets().list("wallpapers"); } catch (Exception e) { walls = new String[0]; }
        wallIdx = Math.min(prefs.getInt("wall", -1), walls.length - 1); // -1 = auto: follows the panel's holiday theme and the weather

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        wall = new ImageView(this); wall.setScaleType(ImageView.ScaleType.CENTER_CROP);
        root.addView(wall, -1, -1);

        LinearLayout top = new LinearLayout(this); top.setOrientation(LinearLayout.VERTICAL);
        top.setPadding(dp(64), dp(40), 0, 0);
        time = text(64, 1f); date = text(22, .8f); wx = text(22, .8f);
        top.addView(time); top.addView(date); top.addView(wx);
        root.addView(top, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START));

        media = new LinearLayout(this); media.setOrientation(LinearLayout.VERTICAL);
        FrameLayout.LayoutParams mp = new FrameLayout.LayoutParams(dp(840), -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        mp.bottomMargin = dp(172);
        root.addView(media, mp);
        roam = new FrameLayout(this); // seasonal walkers cross here, behind the dock
        root.addView(roam, new FrameLayout.LayoutParams(-1, dp(120), Gravity.BOTTOM));

        dock = new LinearLayout(this); dock.setOrientation(LinearLayout.HORIZONTAL);
        dock.setPadding(dp(20), dp(14), dp(20), dp(14)); dock.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(0x4D1E2630); bg.setCornerRadius(dp(34)); dock.setBackground(bg);
        fill(FALLBACK);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lp.bottomMargin = dp(48);
        root.addView(dock, lp);
        corner = new LinearLayout(this); corner.setPadding(0, dp(36), dp(56), 0);
        corner.addView(cornerBtn("power", v -> { // the panel's all-off scene; press twice so it can't happen by accident
            if (System.currentTimeMillis() - armed < 4000) { armed = 0; post("{\"action\":\"scene\",\"name\":\"all_off\"}", "Standby"); }
            else { armed = System.currentTimeMillis(); Toast.makeText(this, "Press again to turn the room off", Toast.LENGTH_SHORT).show(); } }));
        corner.addView(cornerBtn("thx", v -> post("{\"action\":\"preroll_demo\"}", "THX demo"))); // the panel's Sound sheet "Demo": plays the THX clip via Plex
        corner.addView(cornerBtn("wall", v -> setWall(1)));
        corner.addView(cornerBtn("proj", v -> { // the projector's own menu: keystone, focus, picture
            Intent i = getPackageManager().getLaunchIntentForPackage("com.xming.xmprojectorsettings");
            if (i != null) startActivity(i); else Toast.makeText(this, "Projector settings not found", Toast.LENGTH_SHORT).show(); }));
        corner.addView(cornerBtn("gear", v -> { try { startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS)); } catch (Exception e) {} }));
        root.addView(corner, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END));
        setContentView(root);
        dock.getChildAt(0).requestFocus();
        setWall(0);
        loadInputs();
    }

    /** Rebuild the dock: the fixed apps, then the given input tiles. Keeps focus on the same slot. */
    void fill(String[][] inputs) {
        int keep = 0; for (int i = 0; i < dock.getChildCount(); i++) if (dock.getChildAt(i).hasFocus()) keep = i;
        dock.removeAllViews();
        for (String[] a : APPS) dock.addView(item(a));
        for (String[] a : inputs) dock.addView(item(a));
        dock.getChildAt(Math.min(keep, dock.getChildCount() - 1)).requestFocus();
    }

    String panelUrl(String path) { String k = prefs.getString("key", ""); return PANEL + path + (k.isEmpty() ? "" : "?key=" + k); }

    /** Pull the theater panel's input list (Apple TV, Windows, switcher consoles) from its server. */
    void loadInputs() {
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(panelUrl("/api/games")).openConnection();
                c.setConnectTimeout(5000); c.setReadTimeout(5000);
                JSONObject root = new JSONObject(new java.util.Scanner(c.getInputStream()).useDelimiter("\\A").next());
                activeId = root.optString("active", "");
                org.json.JSONArray src = root.getJSONArray("sources");
                final String[][] in = new String[src.length()][];
                for (int i = 0; i < in.length; i++) {
                    JSONObject o = src.getJSONObject(i); String id = o.getString("id");
                    in[i] = new String[]{o.getString("name"), "panel:" + id, "ic_" + o.optString("icon", "").replace(":", "_").replace("-", "_")};
                }
                runOnUiThread(() -> fill(in));
            } catch (Exception ignored) {} // server unreachable: keep the local HDMI tiles
        }).start();
    }

    /** Ask the panel server to switch to an input; it drives the HDMI switcher and the projector input through Home Assistant. */
    void pick(final String id, final String name) { activeId = id; loadInputs(); post("{\"action\":\"game_source\",\"id\":\"" + id + "\"}", name); }

    /** POST an action to the panel server and toast the outcome. */
    void post(final String json, final String name) {
        new Thread(() -> {
            String msg;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(panelUrl("/api/action")).openConnection();
                c.setRequestMethod("POST"); c.setDoOutput(true); c.setConnectTimeout(5000); c.setReadTimeout(20000);
                c.setRequestProperty("content-type", "application/json");
                c.getOutputStream().write(json.getBytes());
                int code = c.getResponseCode();
                if (code < 300) msg = name;
                else { String why = ""; try { why = new JSONObject(new java.util.Scanner(c.getErrorStream()).useDelimiter("\\A").next()).optString("error", ""); } catch (Exception ignored) {}
                    msg = why.isEmpty() ? name + " failed (" + code + ")" : why; }
            } catch (Exception e) { msg = name + " failed: " + e.getMessage(); }
            final String m = msg; runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_SHORT).show());
        }).start();
    }

    /** Small icon button in the top-right corner: "wall" cycles the wallpaper, "gear" opens Android settings. */
    View cornerBtn(final String kind, View.OnClickListener click) {
        View v = new View(this) { @Override protected void onDraw(Canvas c) { drawCorner(c, kind, getWidth()); } };
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(42), dp(42)); lp.leftMargin = dp(10);
        v.setLayoutParams(lp); v.setPadding(dp(6), dp(6), dp(6), dp(6)); v.setFocusable(true); v.setClickable(true);
        final GradientDrawable f = new GradientDrawable(); f.setColor(0x38FFFFFF); f.setCornerRadius(dp(21));
        v.setOnFocusChangeListener((x, has) -> x.setBackground(has ? f : null));
        v.setOnClickListener(click); v.setAlpha(.85f); return v;
    }

    void drawCorner(Canvas c, String kind, int w) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG); p.setColor(Color.WHITE); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(w * .06f);
        p.setStrokeJoin(Paint.Join.ROUND); p.setStrokeCap(Paint.Cap.ROUND);
        float m = w * .2f, s = w - 2 * m, cx = w / 2f;
        if (kind.equals("power")) {
            c.drawArc(new RectF(m + s * .08f, m + s * .08f, m + s * .92f, m + s * .92f), -60, 300, false, p);
            c.drawLine(cx, m, cx, m + s * .48f, p); return;
        }
        if (kind.equals("thx")) { // the demo: a theater screen with seats (mdi:theater)
            android.graphics.drawable.Drawable d = getResources().getDrawable(R.drawable.ic_mdi_theater, null);
            d.setBounds((int) m, (int) m, (int) (w - m), (int) (w - m)); d.draw(c); return;
        }
        if (kind.equals("gear")) {
            for (int i = 0; i < 8; i++) { double a = i * Math.PI / 4; c.drawLine(cx + (float) Math.cos(a) * s * .38f, cx + (float) Math.sin(a) * s * .38f, cx + (float) Math.cos(a) * s * .52f, cx + (float) Math.sin(a) * s * .52f, p); }
            c.drawCircle(cx, cx, s * .38f, p); c.drawCircle(cx, cx, s * .16f, p);
        } else if (kind.equals("proj")) { // projector body with a lens and a beam
            c.drawRoundRect(new RectF(m, m + s * .3f, m + s * .7f, m + s * .8f), s * .1f, s * .1f, p);
            c.drawCircle(m + s * .35f, m + s * .55f, s * .13f, p);
            c.drawLine(m + s * .8f, m + s * .4f, m + s, m + s * .3f, p); c.drawLine(m + s * .8f, m + s * .55f, m + s, m + s * .55f, p); c.drawLine(m + s * .8f, m + s * .7f, m + s, m + s * .8f, p);
        } else { // picture frame with a hill and a sun
            c.drawRoundRect(new RectF(m, m + s * .1f, m + s, m + s * .9f), s * .1f, s * .1f, p);
            Path t = new Path(); t.moveTo(m + s * .08f, m + s * .78f); t.lineTo(m + s * .38f, m + s * .45f); t.lineTo(m + s * .6f, m + s * .65f); t.lineTo(m + s * .72f, m + s * .55f); t.lineTo(m + s * .92f, m + s * .78f); c.drawPath(t, p);
            c.drawCircle(m + s * .72f, m + s * .3f, s * .07f, p);
        }
    }

    int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    TextView text(int sp, float alpha) {
        TextView t = new TextView(this); t.setTextColor(Color.WHITE); t.setAlpha(alpha);
        t.setTextSize(sp); t.setShadowLayer(8, 0, 2, 0x99000000); return t;
    }

    View item(final String[] a) {
        LinearLayout c = new LinearLayout(this); c.setOrientation(LinearLayout.VERTICAL);
        c.setGravity(Gravity.CENTER_HORIZONTAL); c.setPadding(dp(6), dp(14), dp(6), dp(10));
        c.setFocusable(true); c.setClickable(true);
        final GradientDrawable f = new GradientDrawable(); f.setColor(0x38FFFFFF); f.setCornerRadius(dp(24));
        final GradientDrawable on = new GradientDrawable(); on.setColor(0x1AFFFFFF); on.setCornerRadius(dp(24));
        final boolean live = a[1].equals("panel:" + activeId); // the input the panel last switched to
        if (live) c.setBackground(on);
        c.setOnFocusChangeListener((v, has) -> { f.setColor((gold & 0x00FFFFFF) | 0x59000000); v.setBackground(has ? f : live ? on : null); });
        final String icon = a[2];
        View ic = new View(this) {
            @Override protected void onDraw(Canvas cv) { drawIcon(cv, icon, getWidth(), getHeight()); }
        };
        c.addView(ic, dp(48), dp(48));
        TextView l = text(13, .9f); l.setGravity(Gravity.CENTER); l.setMaxLines(1); l.setText(a[0]); l.setPadding(0, dp(8), 0, 0);
        c.addView(l, dp(84), -2);
        c.setOnClickListener(v -> launch(a[1], a[0]));
        return c;
    }

    void drawIcon(Canvas c, String k, int w, int h) {
        int res = k.startsWith("ic_") ? getResources().getIdentifier(k, "drawable", getPackageName()) : 0;
        if (res != 0) { // the panel's own icon, converted to a vector at build time
            android.graphics.drawable.Drawable d = getResources().getDrawable(res, null);
            d.setBounds(0, 0, w, h); d.draw(c); return;
        }
        if (k.startsWith("ic_")) k = "pad"; // an icon this build doesn't have
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG); p.setColor(Color.WHITE);
        float s = w;
        if (k.equals("yt")) {
            c.drawRoundRect(new RectF(s*.06f, s*.2f, s*.94f, s*.8f), s*.18f, s*.18f, p);
            p.setColor(0xFF1E2630); Path t = new Path(); t.moveTo(s*.42f, s*.36f); t.lineTo(s*.66f, s*.5f); t.lineTo(s*.42f, s*.64f); t.close(); c.drawPath(t, p);
        } else if (k.equals("plex")) { // Plex-style chevron
            p.setStyle(Paint.Style.FILL); Path t = new Path();
            t.moveTo(s*.22f, s*.08f); t.lineTo(s*.50f, s*.08f); t.lineTo(s*.80f, s*.5f); t.lineTo(s*.50f, s*.92f); t.lineTo(s*.22f, s*.92f); t.lineTo(s*.52f, s*.5f); t.close(); c.drawPath(t, p);
        } else if (k.equals("tv") || k.equals("pc")) {
            p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(s*.07f); p.setStrokeJoin(Paint.Join.ROUND); p.setStrokeCap(Paint.Cap.ROUND);
            c.drawRoundRect(new RectF(s*.1f, s*.2f, s*.9f, s*.68f), s*.06f, s*.06f, p);
            c.drawLine(s*.5f, s*.68f, s*.5f, s*.82f, p); c.drawLine(s*.32f, s*.84f, s*.68f, s*.84f, p);
        } else if (k.equals("pad")) { // game controller
            p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(s*.07f); p.setStrokeJoin(Paint.Join.ROUND);
            c.drawRoundRect(new RectF(s*.06f, s*.28f, s*.94f, s*.74f), s*.22f, s*.22f, p);
            p.setStyle(Paint.Style.FILL); c.drawRect(s*.22f, s*.46f, s*.38f, s*.52f, p); c.drawRect(s*.27f, s*.4f, s*.33f, s*.58f, p);
            c.drawCircle(s*.66f, s*.43f, s*.04f, p); c.drawCircle(s*.76f, s*.52f, s*.04f, p);
        } else { // HDMI plug
            p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(s*.07f); p.setStrokeJoin(Paint.Join.ROUND);
            Path t = new Path(); t.moveTo(s*.1f, s*.28f); t.lineTo(s*.9f, s*.28f); t.lineTo(s*.9f, s*.55f); t.lineTo(s*.78f, s*.72f); t.lineTo(s*.22f, s*.72f); t.lineTo(s*.1f, s*.55f); t.close(); c.drawPath(t, p);
            p.setStyle(Paint.Style.FILL); for (int i = 0; i < 4; i++) c.drawRect(s*(.24f + i*.14f), s*.4f, s*(.30f + i*.14f), s*.56f, p);
        }
    }

    void launch(String target, String name) {
        try {
            Intent i;
            if (target.startsWith("panel:")) { pick(target.substring(6), name); return; }
            if (target.startsWith("tv:")) {
                i = new Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(target.substring(3)));
            } else {
                String pkg = target.substring(4);
                i = getPackageManager().getLeanbackLaunchIntentForPackage(pkg);
                if (i == null) i = getPackageManager().getLaunchIntentForPackage(pkg);
            }
            if (i != null) startActivity(i);
            else Toast.makeText(this, "Not installed", Toast.LENGTH_SHORT).show();
        } catch (Exception e) { Toast.makeText(this, "Can't open: " + e.getMessage(), Toast.LENGTH_SHORT).show(); }
    }

    /** UP from the dock goes to the corner buttons (wallpaper, settings); DOWN comes back. */
    @Override public boolean onKeyDown(int code, KeyEvent e) {
        boolean inMedia = media.hasFocus(), hasMedia = media.getChildCount() > 0;
        if (code == KeyEvent.KEYCODE_DPAD_UP && !corner.hasFocus() && !(inMedia && !hasMedia)) {
            if (!inMedia && hasMedia) { media.requestFocus(); return true; } // dock -> posters -> corner buttons
            corner.getChildAt(corner.getChildCount() - 1).requestFocus(); return true;
        }
        if (code == KeyEvent.KEYCODE_DPAD_DOWN && corner.hasFocus()) { (hasMedia ? media : dock.getChildAt(0)).requestFocus(); return true; }
        if (code == KeyEvent.KEYCODE_DPAD_DOWN && inMedia) { dock.getChildAt(0).requestFocus(); return true; }
        if (code == KeyEvent.KEYCODE_BACK) return true; // a launcher has nowhere to go back to
        return super.onKeyDown(code, e);
    }

    // ---- continue watching and new releases, from the panel server ----

    final Runnable mediaTick = new Runnable() { public void run() { loadMedia(); h.postDelayed(this, 10 * 60000); } };

    static Bitmap fetchBitmap(String url) {
        try (InputStream in = new URL(url).openStream()) { return BitmapFactory.decodeStream(in); } catch (Exception e) { return null; }
    }

    /** Rows are {section, caption, posterPath, id, type, offsetMs, tmdb, season, episode}. */
    void loadMedia() {
        new Thread(() -> {
            final java.util.List<String[]> items = new java.util.ArrayList<>();
            try {
                JSONArray deck = new JSONArray(get(panelUrl("/api/plex/ondeck?size=6")));
                for (int i = 0; i < deck.length(); i++) {
                    JSONObject o = deck.getJSONObject(i); boolean ep = o.optString("type").equals("episode");
                    String cap = ep ? o.optString("showTitle") : o.optString("title"); boolean dup = false;
                    for (String[] x : items) dup |= x[1].equals(cap);
                    if (dup) continue;
                    items.add(new String[]{"CONTINUE WATCHING", ep ? o.optString("showTitle") : o.optString("title"), o.optString("poster"),
                        o.optString("id"), o.optString("type"), String.valueOf(o.optLong("viewOffset")), "", "", ""});
                }
            } catch (Exception ignored) {}
            try { // what came out since yesterday morning and is already in the library
                SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US); f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                java.util.Calendar cal = java.util.Calendar.getInstance(); cal.add(java.util.Calendar.DAY_OF_YEAR, -1);
                cal.set(java.util.Calendar.HOUR_OF_DAY, 0); cal.set(java.util.Calendar.MINUTE, 0);
                long since = cal.getTimeInMillis(), now = System.currentTimeMillis();
                JSONArray ev = new JSONObject(get(panelUrl("/api/calendar?back=1&ahead=0"))).getJSONArray("events");
                SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                final java.util.List<Object[]> hits = new java.util.ArrayList<>(); // {time, event}
                for (int i = 0; i < ev.length(); i++) {
                    JSONObject o = ev.getJSONObject(i);
                    if (!o.optBoolean("hasFile") || o.optString("poster").isEmpty()) continue;
                    boolean tv = o.optString("kind").equals("tv"); // episodes carry a time, films only a day
                    long at = tv ? f.parse(o.optString("at")).getTime() : day.parse(o.optString("date")).getTime();
                    if (at >= since && at <= now) hits.add(new Object[]{at, o});
                }
                java.util.Collections.sort(hits, (x, y) -> Long.compare((Long) y[0], (Long) x[0]));
                for (int i = 0; i < hits.size() && i < 8; i++) {
                    JSONObject o = (JSONObject) hits.get(i)[1]; boolean tv = o.optString("kind").equals("tv");
                    items.add(new String[]{"NEW SINCE YESTERDAY", o.optString("title"), o.optString("poster"), "", tv ? "episode" : "movie", "0",
                        o.optString("tmdbId"), o.optString("season"), o.optString("episode")});
                }
            } catch (Exception ignored) {}
            final Bitmap[] pics = new Bitmap[items.size()];
            for (int i = 0; i < pics.length; i++) pics[i] = fetchBitmap(panelUrl(items.get(i)[2]));
            runOnUiThread(() -> showMedia(items, pics));
        }).start();
    }

    void showMedia(java.util.List<String[]> items, Bitmap[] pics) {
        boolean had = media.hasFocus();
        media.removeAllViews();
        if (items.isEmpty()) return;
        LinearLayout groups = new LinearLayout(this); groups.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout row = null, col = null; String sec = "";
        for (int i = 0; i < items.size(); i++) {
            final String[] it = items.get(i);
            if (!it[0].equals(sec)) {
                sec = it[0];
                col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL);
                LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-2, -2); cp.rightMargin = dp(28);
                TextView hd = text(12, .7f); hd.setText(sec); hd.setPadding(dp(6), 0, 0, dp(4)); hd.setLetterSpacing(.12f);
                col.addView(hd);
                row = new LinearLayout(this); col.addView(row);
                groups.addView(col, cp);
            }
            LinearLayout t = new LinearLayout(this); t.setOrientation(LinearLayout.VERTICAL); t.setGravity(Gravity.CENTER_HORIZONTAL);
            t.setPadding(dp(5), dp(5), dp(5), dp(4)); t.setFocusable(true); t.setClickable(true);
            ImageView im = new ImageView(this); im.setScaleType(ImageView.ScaleType.CENTER_CROP); im.setImageBitmap(pics[i]);
            GradientDrawable ph = new GradientDrawable(); ph.setColor(0x33FFFFFF); ph.setCornerRadius(dp(8)); im.setBackground(ph); im.setClipToOutline(true);
            t.addView(im, dp(74), dp(111));
            TextView cap = text(11, .85f); cap.setMaxLines(1); cap.setGravity(Gravity.CENTER); cap.setText(it[1]); cap.setPadding(0, dp(3), 0, 0);
            cap.setEllipsize(android.text.TextUtils.TruncateAt.END);
            t.addView(cap, dp(74), -2);
            final GradientDrawable f = new GradientDrawable(); f.setCornerRadius(dp(12));
            t.setOnFocusChangeListener((v, has) -> { f.setColor((gold & 0x00FFFFFF) | 0x59000000); v.setBackground(has ? f : null); });
            t.setOnClickListener(v -> play(it));
            row.addView(t);
        }
        HorizontalScrollView sv = new HorizontalScrollView(this); sv.setHorizontalScrollBarEnabled(false); sv.addView(groups);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(0x4D1E2630); bg.setCornerRadius(dp(24));
        sv.setBackground(bg); sv.setPadding(dp(18), dp(12), dp(10), dp(6));
        media.addView(sv, -1, -2);
        if (had) media.requestFocus();
    }

    /** Press twice, like standby: playing wakes the projector and dims the room. */
    void play(final String[] it) {
        String key = it[0] + it[1];
        if (!key.equals(armedKey) || System.currentTimeMillis() - armedPlay > 4000) {
            armedKey = key; armedPlay = System.currentTimeMillis();
            Toast.makeText(this, "Press again to play " + it[1], Toast.LENGTH_SHORT).show(); return;
        }
        armedKey = "";
        new Thread(() -> {
            try {
                String id = it[3];
                if (id.isEmpty()) { // a release: find the Plex copy first
                    String r = get(panelUrl("/api/plex/episode?tmdb=" + it[6] + "&season=" + it[7] + "&episode=" + it[8]));
                    id = r.trim().equals("null") ? "" : new JSONObject(r).optString("id");
                }
                if (id.isEmpty()) { runOnUiThread(() -> Toast.makeText(this, it[1] + " isn't in Plex yet", Toast.LENGTH_LONG).show()); return; }
                post("{\"action\":\"play\",\"ratingKey\":\"" + id + "\",\"type\":\"" + it[4] + "\",\"offset\":" + it[5] + "}", "Playing " + it[1]);
            } catch (Exception e) { runOnUiThread(() -> Toast.makeText(this, "Couldn't start " + it[1], Toast.LENGTH_LONG).show()); }
        }).start();
    }

    // ---- seasonal walkers: the panel's sprite atlases (12x8 frames), crossing now and then ----

    static final java.util.Map<String, String[]> WALKERS = new java.util.HashMap<>();
    static {
        WALKERS.put("thanksgiving", new String[]{"turkey", "pilgrim", "dash"});
        WALKERS.put("christmas", new String[]{"elf", "reindeer", "santa"});
    }
    final java.util.Random rnd = new java.util.Random();

    final Runnable walker = new Runnable() { public void run() {
        String[] kinds = WALKERS.get(accent);
        if (kinds != null) walk(kinds[rnd.nextInt(kinds.length)]);
        h.postDelayed(this, 25000 + rnd.nextInt(35000));
    }};

    void walk(String kind) {
        final Bitmap atlas;
        try (InputStream in = getAssets().open("sprites/" + kind + ".png")) { atlas = BitmapFactory.decodeStream(in); } catch (Exception e) { return; }
        final int cell = atlas.getWidth() / 12, size = dp(100);
        final Rect src = new Rect(), dst = new Rect(0, 0, size, size);
        final int[] frame = {0};
        final View v = new View(this) { @Override protected void onDraw(Canvas c) {
            int f = frame[0]; src.set(f % 12 * cell, f / 12 * cell, f % 12 * cell + cell, f / 12 * cell + cell);
            c.drawBitmap(atlas, src, dst, null);
        }};
        int w = getResources().getDisplayMetrics().widthPixels;
        roam.addView(v, new FrameLayout.LayoutParams(size, size, Gravity.BOTTOM));
        v.setTranslationX(-size);
        v.animate().translationX(w).setDuration(12000).setInterpolator(new android.view.animation.LinearInterpolator()).start();
        final Runnable[] step = new Runnable[1];
        step[0] = () -> { // stepped frames, as on the panel
            if (v.getParent() == null) return;
            frame[0] = (frame[0] + 1) % 96; v.invalidate(); h.postDelayed(step[0], 110);
        };
        h.post(step[0]);
        h.postDelayed(() -> { roam.removeView(v); atlas.recycle(); }, 12500);
    }

    /** d != 0 steps through Auto, then each wallpaper; Auto picks by the panel's holiday theme, else the weather. */
    void setWall(int d) {
        if (walls.length == 0) return;
        if (d != 0) {
            wallIdx += d; if (wallIdx >= walls.length) wallIdx = -1; if (wallIdx < -1) wallIdx = walls.length - 1;
            prefs.edit().putInt("wall", wallIdx).apply();
            Toast.makeText(this, wallIdx < 0 ? "Wallpaper: Auto" : "Wallpaper " + (wallIdx + 1) + "/" + walls.length, Toast.LENGTH_SHORT).show();
        }
        String name = wallIdx < 0 ? autoWall() : walls[wallIdx];
        try (InputStream in = getAssets().open("wallpapers/" + name)) { wall.setImageBitmap(BitmapFactory.decodeStream(in)); }
        catch (Exception ignored) {}
    }

    /** Holidays win (as on the panel); the plain seasons fall through to the weather. */
    String autoWall() {
        switch (accent) {
            case "halloween": return "w05.jpg";   // ember horizon
            case "thanksgiving": return "w18.jpg"; // low poly ember
            case "christmas": return "w07.jpg";   // crimson corners
            case "newyear": return "w11.jpg";     // star field
            case "valentines": case "birthday": return "w14.jpg"; // neon orbs
        }
        if (cond.equals("snowy") || cond.equals("snowy-rainy") || cond.equals("hail")) return "w15.jpg"; // moonlit slate
        if (cond.equals("rainy") || cond.equals("pouring") || cond.equals("lightning") || cond.equals("lightning-rainy")) return "w09.jpg"; // ocean floor
        if (cond.equals("fog")) return "w13.jpg";  // graphite mist
        if (cond.equals("clear-night")) return "w11.jpg";
        switch (accent) { case "fall": return "w10.jpg"; case "spring": return "w12.jpg"; case "winter": return "w08.jpg"; }
        return "w04.jpg";
    }

    final Runnable tick = new Runnable() { public void run() {
        Date n = new Date();
        time.setText(new SimpleDateFormat("h:mm", Locale.US).format(n));
        date.setText(new SimpleDateFormat("EEEE, MMMM d", Locale.US).format(n));
        h.postDelayed(this, 10000);
    }};
    final Runnable weather = new Runnable() { public void run() {
        new Thread(() -> {
            String line = null;
            try { // the panel server: Home Assistant's weather plus the holiday accent, no token on this device
                JSONObject o = new JSONObject(get(panelUrl("/api/companion")));
                JSONObject a = o.getJSONObject("accent"); final String id = a.getString("id");
                final int g = Color.parseColor(a.getString("gold"));
                JSONObject w = o.optJSONObject("weather");
                if (w != null && !w.isNull("temp")) {
                    final String c = w.getString("condition");
                    line = Math.round(w.getDouble("temp")) + w.optString("unit", "°F") + " · " + label(c) + " · North Royalton";
                    cond = c;
                }
                accent = id; gold = g;
            } catch (Exception ignored) {}
            if (line == null) try { // older panel build or no weather entity: Open-Meteo for 44133
                JSONObject cur = new JSONObject(get("https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON
                    + "&current=temperature_2m,weather_code&temperature_unit=fahrenheit")).getJSONObject("current");
                int code = cur.getInt("weather_code");
                line = Math.round(cur.getDouble("temperature_2m")) + "°F · " + cond(code) + " · North Royalton";
                cond = code == 0 ? "sunny" : code >= 71 && code < 78 ? "snowy" : code >= 51 && code < 70 ? "rainy" : code >= 80 && code < 90 ? "rainy" : code == 45 || code == 48 ? "fog" : "cloudy";
            } catch (Exception ignored) {}
            final String t = line;
            runOnUiThread(() -> { if (t != null) wx.setText(t); setWall(0); });
        }).start();
        h.postDelayed(this, 5 * 60000);
    }};

    static String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection(); c.setConnectTimeout(6000); c.setReadTimeout(8000);
        if (c.getResponseCode() >= 300) throw new Exception("HTTP " + c.getResponseCode());
        return new java.util.Scanner(c.getInputStream()).useDelimiter("\\A").next();
    }

    /** Home Assistant weather state -> words. */
    static String label(String c) {
        switch (c) {
            case "sunny": return "Sunny"; case "clear-night": return "Clear"; case "partlycloudy": return "Partly cloudy"; case "cloudy": return "Cloudy";
            case "rainy": return "Rain"; case "pouring": return "Heavy rain"; case "snowy": return "Snow"; case "snowy-rainy": return "Sleet";
            case "fog": return "Fog"; case "windy": case "windy-variant": return "Windy"; case "hail": return "Hail";
            case "lightning": case "lightning-rainy": return "Storms"; default: return c;
        }
    }

    static String cond(int c) {
        if (c == 0) return "Clear"; if (c <= 2) return "Partly cloudy"; if (c == 3) return "Cloudy";
        if (c == 45 || c == 48) return "Fog"; if (c < 60) return "Drizzle"; if (c < 70) return "Rain";
        if (c < 80) return "Snow"; if (c < 90) return "Showers"; return "Storms";
    }

    @Override protected void onResume() { super.onResume(); tick.run(); weather.run(); h.removeCallbacks(mediaTick); mediaTick.run(); h.removeCallbacks(walker); h.postDelayed(walker, 6000); }
    @Override protected void onPause() { super.onPause(); h.removeCallbacksAndMessages(null); roam.removeAllViews(); }
}
