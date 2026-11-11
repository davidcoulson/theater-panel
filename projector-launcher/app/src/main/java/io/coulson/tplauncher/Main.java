package io.coulson.tplauncher;

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
        {"Movie night", "night:", "night"},
    };
    // Shown until the theater-panel server answers; then its input list (Apple TV, Windows, consoles) replaces them.
    static final String[][] FALLBACK = {
        {"HDMI 1", "tv:com.mediatek.tvinput/.hdmi.HDMIInputService/HW5", "hdmi"},
        {"HDMI 2", "tv:com.mediatek.tvinput/.hdmi.HDMIInputService/HW6", "hdmi"},
    };
    static final String PANEL = "http://10.2.6.45:8787"; // theater-panel server; add ?key= via prefs "key" if the projector isn't a trusted network
    LinearLayout dock, corner;
    LinearLayout media; FrameLayout roam; String armedKey = ""; long armedPlay = 0; boolean wantHero; LinearLayout filmRow, showRow;
    java.util.List<String[]> lastItems = new java.util.ArrayList<>(); Bitmap[] lastPics = new Bitmap[0];
    java.util.List<String[]> picks; Bitmap[] pickPics; // Movie night: the panel's picks take over the New half until Back
    JSONObject now; Bitmap nowPic; String nowKey = "", nowArt = ""; View nowFill; // what the projector is playing // coming home lands on continue watching
    String accent = "", cond = "", activeId = ""; int gold = 0xFFFFFFFF; long armed = 0;
    static final double LAT = 41.3136, LON = -81.7240; // 44133 North Royalton, OH
    ImageView wall; TextView time, date, wx; String[] walls; int wallIdx;
    SharedPreferences prefs; final Handler h = new Handler();
    volatile int gen; // bumped on every pause and resume: a load that started before that must not publish
    boolean panelShown; // the dock is showing the server's inputs rather than the local HDMI fallback
    String heroKey = ""; // which continue-watching item is on the card, by identity rather than slot
    void ui(final int g, final Runnable r) { runOnUiThread(() -> { if (g == gen && !isFinishing()) r.run(); }); }

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
        top.setPadding(dp(64), dp(20), 0, 0);
        time = text(28, 1f); date = text(22, .8f); wx = text(22, .8f);
        top.addView(time); // date and weather hidden for now: top.addView(date); top.addView(wx);
        root.addView(top, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START));

        media = new LinearLayout(this); media.setOrientation(LinearLayout.VERTICAL);
        FrameLayout.LayoutParams mp = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        mp.leftMargin = mp.rightMargin = dp(24);
        mp.bottomMargin = dp(104);
        root.addView(media, mp);
        roam = new FrameLayout(this); // seasonal walkers cross here
        root.addView(roam, new FrameLayout.LayoutParams(-1, dp(120), Gravity.BOTTOM));

        dock = new LinearLayout(this); dock.setOrientation(LinearLayout.HORIZONTAL);
        dock.setPadding(dp(16), dp(8), dp(16), dp(8)); dock.setClipChildren(false); dock.setClipToPadding(false); dock.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(0x4D1E2630); bg.setCornerRadius(dp(34)); dock.setBackground(bg);
        fill(FALLBACK);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lp.bottomMargin = dp(14); // clear of the screen edge
        root.addView(dock, lp); roam.bringToFront(); // walkers pass in front of the dock, so its tint does not wash them out
        corner = new LinearLayout(this); corner.setPadding(0, dp(16), dp(56), 0);
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
    }

    /** Rebuild the dock: the fixed apps, then the given input tiles. Keeps focus on the same slot. */
    void fill(String[][] inputs) {
        boolean had = dock.hasFocus() || getCurrentFocus() == null;
        int keep = 0; for (int i = 0; i < dock.getChildCount(); i++) if (dock.getChildAt(i).hasFocus()) keep = i;
        dock.removeAllViews();
        for (String[] a : APPS) dock.addView(item(a));
        for (String[] a : inputs) dock.addView(item(a));
        if (had) dock.getChildAt(Math.min(keep, dock.getChildCount() - 1)).requestFocus();
    }

    String panelUrl(String path) { String k = prefs.getString("key", ""); return PANEL + path + (k.isEmpty() ? "" : (path.contains("?") ? "&" : "?") + "key=" + android.net.Uri.encode(k)); }

    /** Pull the theater panel's input list (Apple TV, Windows, switcher consoles) from its server. */
    void loadInputs() {
        final int g = gen;
        new Thread(() -> {
            try {
                JSONObject root = new JSONObject(get(panelUrl("/api/games")));
                final String active = root.optString("active", "");
                org.json.JSONArray src = root.getJSONArray("sources");
                final String[][] in = new String[src.length()][];
                for (int i = 0; i < in.length; i++) {
                    JSONObject o = src.getJSONObject(i); String id = o.getString("id");
                    in[i] = new String[]{o.getString("name"), "panel:" + id, "ic_" + o.optString("icon", "").replace(":", "_").replace("-", "_")};
                }
                ui(g, () -> { activeId = active; panelShown = true; fill(in); });
            } catch (Exception ignored) { // server gone: the local HDMI tiles come back, they need no server
                ui(g, () -> { if (panelShown) { panelShown = false; fill(FALLBACK); } });
            }
        }).start();
    }

    /** Ask the panel server to switch to an input; it drives the HDMI switcher and the projector input through Home Assistant. */
    void pick(final String id, final String name) { activeId = id; loadInputs(); post("{\"action\":\"game_source\",\"id\":\"" + id + "\"}", name); }

    /** POST an action to the panel server and toast the outcome. */
    void post(String json, String name) { post("/api/action", json, name); }
    void post(final String path, final String json, final String name) {
        new Thread(() -> {
            String msg;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(panelUrl(path)).openConnection();
                c.setRequestMethod("POST"); c.setDoOutput(true); c.setConnectTimeout(5000); c.setReadTimeout(20000);
                c.setRequestProperty("content-type", "application/json");
                c.getOutputStream().write(json.getBytes());
                int code = c.getResponseCode();
                if (code < 300) msg = name;
                else { String why = ""; try { why = new JSONObject(new java.util.Scanner(c.getErrorStream()).useDelimiter("\\A").next()).optString("error", ""); } catch (Exception ignored) {}
                    msg = why.isEmpty() ? name + " failed (" + code + ")" : why; }
            } catch (Exception e) { msg = name + " failed: " + e.getMessage(); }
            final String m = msg; if (!m.isEmpty()) runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_SHORT).show());
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
            Path g = new Path(); // one toothed outline: spokes on a ring read as a ship's wheel
            for (int i = 0; i < 6; i++) for (int j = 0; j < 4; j++) {
                double a = i * Math.PI / 3 + new double[]{-.32, -.19, .19, .32}[j]; float r = s * (j == 1 || j == 2 ? .52f : .38f);
                float x = cx + (float) Math.cos(a) * r, y = cx + (float) Math.sin(a) * r; if (i + j == 0) g.moveTo(x, y); else g.lineTo(x, y); }
            g.close(); c.drawPath(g, p); c.drawCircle(cx, cx, s * .15f, p);
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
        c.setGravity(Gravity.CENTER_HORIZONTAL); c.setPadding(dp(4), dp(8), dp(4), dp(6));
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
        c.addView(ic, dp(38), dp(38));
        TextView l = text(11, .9f); l.setGravity(Gravity.CENTER); l.setMaxLines(1); l.setText(a[0]); l.setPadding(0, dp(8), 0, 0);
        c.addView(l, dp(70), -2);
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
        } else if (k.equals("night")) { // star: the panel picks tonight's film
            Path t = new Path();
            for (int i = 0; i < 10; i++) { double a = Math.PI * i / 5 - Math.PI / 2; float r = s * (i % 2 == 0 ? .46f : .19f);
                float x = s*.5f + r * (float) Math.cos(a), y = s*.52f + r * (float) Math.sin(a); if (i == 0) t.moveTo(x, y); else t.lineTo(x, y); }
            t.close(); c.drawPath(t, p);
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
            if (target.equals("night:")) { movieNight(); return; }
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

    /** Focus is in poster row a: move to the poster at the same slot in row b. */
    boolean rowStep(LinearLayout a, LinearLayout b) {
        if (a == null || b == null || !a.hasFocus() || b.getChildCount() == 0) return false;
        return b.getChildAt(Math.min(a.indexOfChild(a.getFocusedChild()), b.getChildCount() - 1)).requestFocus();
    }

    /** A key press means the user has taken over: a late first answer must not pull focus away from where they went. */
    @Override public boolean dispatchKeyEvent(KeyEvent e) { if (e.getAction() == KeyEvent.ACTION_DOWN) wantHero = false; return super.dispatchKeyEvent(e); }

    /** UP from the dock goes to the corner buttons (wallpaper, settings); DOWN comes back. */
    @Override public boolean onKeyDown(int code, KeyEvent e) {
        boolean inMedia = media.hasFocus(), inBar = corner.hasFocus(), hasMedia = media.getChildCount() > 0;
        if (code == KeyEvent.KEYCODE_DPAD_UP) { // dock -> posters -> corner buttons
            if (inBar) return true;
            if (inMedia && rowStep(showRow, filmRow)) return true;
            if (!inMedia && hasMedia) { media.requestFocus(); return true; }
            corner.getChildAt(corner.getChildCount() - 1).requestFocus(); return true;
        }
        if (code == KeyEvent.KEYCODE_DPAD_DOWN) { // corner buttons -> posters -> dock
            if (inBar) { (hasMedia ? media : dock.getChildAt(0)).requestFocus(); return true; }
            if (inMedia && rowStep(filmRow, showRow)) return true;
            if (inMedia) { dock.getChildAt(0).requestFocus(); return true; }
            return true;
        }
        if (code == KeyEvent.KEYCODE_BACK && picks != null) { picks = null; showMedia(lastItems, lastPics); return true; }
        if (code == KeyEvent.KEYCODE_BACK) return true; // a launcher has nowhere to go back to
        return super.onKeyDown(code, e);
    }

    // ---- continue watching and new releases, from the panel server ----

    final Runnable mediaTick = new Runnable() { public void run() { loadMedia(); h.postDelayed(this, 10 * 60000); } };

    /** Whole response with a size cap and a deadline, so a trickling server can hold neither a worker nor the heap. */
    static byte[] readAll(java.net.URLConnection c, int max, long ms) throws Exception {
        long end = System.currentTimeMillis() + ms;
        try (InputStream in = c.getInputStream()) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(); byte[] buf = new byte[16384]; int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (out.size() > max) throw new Exception("too large");
                if (System.currentTimeMillis() > end) throw new Exception("too slow");
            }
            return out.toByteArray();
        }
    }

    /** A transparent PNG logo (the server only sends PNG once it knows the f=png option); anything else, or a show without one, is null. */
    static Bitmap fetchLogo(String url, int w, int h) {
        try {
            java.net.URLConnection c = new URL(url).openConnection(); c.setConnectTimeout(5000); c.setReadTimeout(8000);
            if (!"image/png".equals(c.getContentType())) return null;
            byte[] d = readAll(c, 2 << 20, 15000);
            BitmapFactory.Options o = new BitmapFactory.Options(); o.inJustDecodeBounds = true; BitmapFactory.decodeByteArray(d, 0, d.length, o);
            if (o.outWidth <= 0 || o.outHeight <= 0) return null;
            int s = 1; while (o.outWidth / (s * 2) >= w && o.outHeight / (s * 2) >= h) s *= 2;
            o.inJustDecodeBounds = false; o.inSampleSize = s;
            return BitmapFactory.decodeByteArray(d, 0, d.length, o);
        } catch (Exception | OutOfMemoryError e) { return null; }
    }

    java.util.Map<String, Bitmap> logos = new java.util.HashMap<>(); // ident -> the show's logo

    /** A picture decoded no larger than about w x h (the size it is shown at), 16-bit: the projector is a 32-bit box with a small heap. */
    static Bitmap fetchBitmap(String url, int w, int h) {
        try {
            java.net.URLConnection c = new URL(url).openConnection(); c.setConnectTimeout(5000); c.setReadTimeout(8000);
            byte[] d = readAll(c, 6 << 20, 15000);
            BitmapFactory.Options o = new BitmapFactory.Options(); o.inJustDecodeBounds = true; BitmapFactory.decodeByteArray(d, 0, d.length, o);
            if (o.outWidth <= 0 || o.outHeight <= 0) return null;
            int s = 1; while (o.outWidth / (s * 2) >= w && o.outHeight / (s * 2) >= h) s *= 2;
            o.inJustDecodeBounds = false; o.inSampleSize = s; o.inPreferredConfig = Bitmap.Config.RGB_565;
            Bitmap b = BitmapFactory.decodeByteArray(d, 0, d.length, o);
            if (b == null) return null;
            float k = Math.max((float) w / b.getWidth(), (float) h / b.getHeight()); // still covers w x h, so CENTER_CROP has enough
            if (k < .8f) { Bitmap t = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * k), Math.round(b.getHeight() * k), true); if (t != b) b.recycle(); b = t; }
            return b;
        } catch (Exception | OutOfMemoryError e) { return null; }
    }

    /** Rows are {section, caption, posterPath, id, type, offsetMs, tmdb, season, episode}. */
    void loadMedia() {
        final int g = gen;
        new Thread(() -> {
            final java.util.List<String[]> items = new java.util.ArrayList<>();
            try {
                JSONArray deck = new JSONArray(get(panelUrl("/api/plex/ondeck?size=6")));
                for (int i = 0; i < deck.length(); i++) {
                    JSONObject o = deck.getJSONObject(i); boolean ep = o.optString("type").equals("episode");
                    String cap = ep ? o.optString("showTitle") : o.optString("title"); boolean dup = false;
                    for (String[] x : items) dup |= x[1].equals(cap);
                    if (dup) continue;
                    long off = o.optLong("viewOffset"), dur = Math.max(1, o.optLong("duration"));
                    String sub = ep ? "S" + o.optInt("season") + " · E" + o.optInt("episode") + " · " + o.optString("title") : (o.optInt("year") > 0 ? "" + o.optInt("year") : "");
                    String still = !str(o, "art").isEmpty() ? str(o, "art") : !str(o, "still").isEmpty() ? str(o, "still") : str(o, "poster"); // same pick as the panel: the show backdrop first
                    items.add(new String[]{"CONTINUE WATCHING", cap, still, o.optString("id"), o.optString("type"), String.valueOf(off), "", "", "",
                        sub, String.valueOf(off * 100 / dur), o.optString("who"), off > 0 ? "Resume at " + clock(off) : "Up next", ep ? o.optString("showKey") : o.optString("id")});
                }
            } catch (Exception ignored) {}
            try { // newest releases already in the library; two weeks back is enough to fill both rows
                SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US); f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                long now = System.currentTimeMillis();
                JSONArray ev = new JSONObject(get(panelUrl("/api/calendar?back=14&ahead=0"))).getJSONArray("events");
                SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                final java.util.List<Object[]> hits = new java.util.ArrayList<>(); // {time, event}
                for (int i = 0; i < ev.length(); i++) {
                    JSONObject o = ev.getJSONObject(i);
                    if (!o.optBoolean("hasFile") || o.optString("poster").isEmpty()) continue;
                    boolean tv = o.optString("kind").equals("tv"); // episodes carry a time, films only a day
                    long at; try { at = tv ? f.parse(o.optString("at")).getTime() : day.parse(o.optString("date")).getTime(); } catch (Exception bad) { continue; }
                    if (at <= now) hits.add(new Object[]{at, o});
                }
                java.util.Collections.sort(hits, (x, y) -> Long.compare((Long) y[0], (Long) x[0]));
                int nf = 0, nt = 0; // newest six of each
                for (int i = 0; i < hits.size(); i++) {
                    JSONObject o = (JSONObject) hits.get(i)[1]; boolean tv = o.optString("kind").equals("tv");
                    boolean dup = false; // one tile per title across both groups
                    for (String[] x : items) dup |= x[1].equals(o.optString("title"));
                    if (dup) continue;
                    if (tv ? nt++ >= 6 : nf++ >= 6) continue;
                    items.add(new String[]{"NEW", o.optString("title"), o.optString("poster"), "", tv ? "episode" : "movie", "0",
                        o.optString("tmdbId"), o.optString("season"), o.optString("episode"), "", "0", "", ""});
                }
            } catch (Exception ignored) {}
            final Bitmap[] pics = new Bitmap[items.size()];
            for (int i = 0; i < pics.length; i++) pics[i] = items.get(i)[0].startsWith("CONTINUE") ? fetchBitmap(panelUrl(items.get(i)[2]), 840, 472) : fetchBitmap(panelUrl(items.get(i)[2]), 248, 372);
            final java.util.Map<String, Bitmap> lg = new java.util.HashMap<>();
            for (String[] it : items) if (it[0].startsWith("CONTINUE") && it.length > 13 && !it[13].isEmpty()) {
                Bitmap b = fetchLogo(panelUrl("/img/plex/600x240?f=png&p=" + android.net.Uri.encode("/library/metadata/" + it[13] + "/clearLogo")), 420, 120);
                if (b != null) lg.put(ident(it), b);
            }
            ui(g, () -> { logos = lg; showMedia(items, pics); });
        }).start();
    }

    int heroIdx = 0;
    /** Which media item a row is: Plex id, else type, title and tmdb/season/episode. */
    static String ident(String[] it) { return it[3] + "|" + it[4] + "|" + it[1] + "|" + it[6] + "|" + it[7] + "|" + it[8]; }

    static String clock(long ms) { long m = ms / 60000; return m >= 60 ? (m / 60) + "h " + (m % 60) + "m" : m + " min"; }

    /** A focusable poster; the poster says the title, pressing it names it. */
    View poster(final String[] it, Bitmap b, int w, int hgt) {
        LinearLayout t = new LinearLayout(this); t.setPadding(dp(4), dp(4), dp(4), dp(4)); t.setFocusable(true); t.setClickable(true);
        ImageView im = new ImageView(this); im.setScaleType(ImageView.ScaleType.CENTER_CROP); im.setImageBitmap(b);
        GradientDrawable ph = new GradientDrawable(); ph.setColor(0x33FFFFFF); ph.setCornerRadius(dp(8)); im.setBackground(ph); im.setClipToOutline(true);
        t.addView(im, dp(w), dp(hgt)); t.setTag("p" + it[3] + it[1]); // tags let showMedia put focus back after a rebuild
        focusTint(t, 12);
        t.setOnClickListener(v -> play(it));
        return t;
    }
    /** A JSON string field, with JSON null as empty (optString would say "null"). */
    static String str(JSONObject o, String k) { return o.isNull(k) ? "" : o.optString(k); }
    /** A small text button for the now-playing card. */
    View pill(String label, View.OnClickListener click) {
        TextView t = text(14, 1f); t.setText(label); t.setPadding(dp(12), dp(7), dp(12), dp(7)); t.setFocusable(true); t.setClickable(true);
        focusTint(t, 16); t.setOnClickListener(click); t.setTag("b" + label); return t;
    }

    /** Movie night: three unwatched films from the panel's picker (the season's shelf in the holiday months). */
    void movieNight() {
        Toast.makeText(this, "Picking…", Toast.LENGTH_SHORT).show();
        final int g = gen;
        new Thread(() -> {
            try {
                JSONArray a = new JSONObject(get(panelUrl("/api/pick?n=3"))).getJSONArray("items");
                final java.util.List<String[]> p = new java.util.ArrayList<>();
                for (int i = 0; i < a.length(); i++) { JSONObject o = a.getJSONObject(i);
                    p.add(new String[]{"PICK", o.optString("title"), o.optString("poster"), o.optString("id"), "movie", "0", "", "", "", "", "0", "", ""}); }
                final Bitmap[] b = new Bitmap[p.size()];
                for (int i = 0; i < b.length; i++) b[i] = fetchBitmap(panelUrl(p.get(i)[2]), 312, 468);
                ui(g, () -> { picks = p; pickPics = b; showMedia(lastItems, lastPics);
                    if (filmRow != null && filmRow.getChildCount() > 0) filmRow.getChildAt(0).requestFocus(); });
            } catch (Exception e) { ui(g, () -> Toast.makeText(this, "Couldn't pick a film", Toast.LENGTH_SHORT).show()); }
        }).start();
    }

    /** Every few seconds: what the projector is playing, for the card that takes the left half meanwhile. */
    volatile boolean nowBusy; // one poll at a time: a slow panel must not stack up requests
    final Runnable nowTick = new Runnable() { public void run() {
        final int g = gen;
        if (!nowBusy) { nowBusy = true; new Thread(() -> {
            try {
                JSONObject o = new JSONObject(get(panelUrl("/api/companion")));
                JSONObject sh = o.optJSONObject("showing"); final JSONObject warn = o.optJSONObject("pauseWarn");
                // A paused app with no Plex session (YouTube) still gets its warning and Keep on.
                if (sh == null && warn != null) sh = new JSONObject().put("title", "Paused").put("state", "paused");
                final JSONObject s = sh;
                if (s != null && warn != null) s.put("warnAt", warn.optLong("at"));
                final String art = s == null ? "" : str(s, "art").isEmpty() ? str(s, "poster") : str(s, "art");
                final Bitmap pic = !art.isEmpty() && !art.equals(nowArt) ? fetchBitmap(panelUrl(art), 840, 472) : null;
                ui(g, () -> {
                    if (pic != null) { nowPic = pic; nowArt = art; }
                    else if (!art.equals(nowArt)) { nowPic = null; nowArt = ""; } // never the last film's picture; the next tick tries again
                    now = s;
                    String key = s == null ? "" : s.optString("title") + str(s, "showTitle") + s.optString("state") + s.optLong("warnAt") + nowArt;
                    if (!key.equals(nowKey)) { nowKey = key; showMedia(lastItems, lastPics); }
                    else if (s != null && nowFill != null) nowFill.getLayoutParams().width = dp(340) * (int) Math.min(100, s.optLong("viewOffset") * 100 / Math.max(1, s.optLong("duration"))) / 100;
                    if (nowFill != null) nowFill.requestLayout();
                });
            } catch (Exception ignored) {} finally { nowBusy = false; }
        }).start(); }
        h.postDelayed(this, 5000);
    }};

    /** Left: the panel's one-at-a-time card (left/right steps through the deck). Right: what's new, as posters. */
    void showMedia(java.util.List<String[]> items, Bitmap[] pics) {
        boolean had = media.hasFocus();
        View was = media.findFocus(); final Object wasTag = was == null ? null : was.getTag();
        lastItems = items; lastPics = pics; nowFill = null;
        media.removeAllViews();
        final java.util.List<String[]> deck = new java.util.ArrayList<>(); final java.util.List<Bitmap> stills = new java.util.ArrayList<>();
        final LinearLayout films = filmRow = new LinearLayout(this), shows = showRow = new LinearLayout(this); // one row each
        for (int i = 0; i < items.size(); i++) {
            final String[] it = items.get(i);
            if (it[0].startsWith("CONTINUE")) { deck.add(it); stills.add(pics[i]); continue; }
            if (picks == null) (it[4].equals("movie") ? films : shows).addView(poster(it, pics[i], 62, 93));
        }
        LinearLayout both = new LinearLayout(this); both.setPadding(dp(18), dp(12), dp(10), dp(6));
        if (now != null) { // something is on: the card and its controls stand in for continue watching
            final boolean paused = now.optString("state").equals("paused"); final long warnAt = now.optLong("warnAt");
            LinearLayout col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL); col.setGravity(Gravity.CENTER_HORIZONTAL);
            TextView hd = text(12, .7f); hd.setText(paused ? "PAUSED" : "NOW PLAYING"); hd.setPadding(dp(6), 0, 0, dp(4)); hd.setLetterSpacing(.12f); col.addView(hd, dp(352), -2);
            ImageView img = new ImageView(this); img.setScaleType(ImageView.ScaleType.CENTER_CROP); img.setImageBitmap(nowPic);
            GradientDrawable ph = new GradientDrawable(); ph.setColor(0x33FFFFFF); ph.setCornerRadius(dp(10)); img.setBackground(ph); img.setClipToOutline(true);
            col.addView(img, dp(340), dp(150));
            FrameLayout bar = new FrameLayout(this); bar.setBackgroundColor(0x33FFFFFF); nowFill = new View(this); nowFill.setBackgroundColor(gold | 0xFF000000);
            bar.addView(nowFill, dp(340) * (int) Math.min(100, now.optLong("viewOffset") * 100 / Math.max(1, now.optLong("duration"))) / 100, dp(3));
            LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(dp(340), dp(3)); bl.topMargin = dp(6); col.addView(bar, bl);
            TextView title = text(20, 1f); title.setMaxLines(1); title.setTypeface(Typeface.DEFAULT_BOLD); title.setPadding(0, dp(6), 0, 0);
            String show = now.isNull("showTitle") ? "" : now.optString("showTitle");
            title.setText(show.isEmpty() ? now.optString("title") : show + " · " + now.optString("title")); col.addView(title, dp(340), -2);
            if (warnAt > 0) { TextView w = text(13, .8f); w.setText("Picture goes off at " + new SimpleDateFormat("h:mm", Locale.US).format(new Date(warnAt))); col.addView(w, dp(340), -2); }
            LinearLayout btns = new LinearLayout(this);
            if (warnAt > 0) btns.addView(pill("Keep on", v -> post("/api/keep-on", "{}", "Staying on")));
            View pp = pill(paused ? "Play" : "Pause", v -> post("{\"action\":\"transport\",\"cmd\":\"play_pause\"}", "")); pp.setTag("bplaypause"); btns.addView(pp);
            btns.addView(pill("Vol −", v -> post("{\"action\":\"transport\",\"cmd\":\"vol_down\"}", "")));
            btns.addView(pill("Vol +", v -> post("{\"action\":\"transport\",\"cmd\":\"vol_up\"}", "")));
            btns.addView(pill("Late night", v -> post("{\"action\":\"soundbar\",\"cmd\":\"late_night\",\"on\":true}", "Late night sound")));
            col.addView(btns, dp(352), -2);
            both.addView(col, new LinearLayout.LayoutParams(0, -2, 1f));
        } else if (!deck.isEmpty()) {
            int at = -1; for (int k = 0; k < deck.size(); k++) if (ident(deck.get(k)).equals(heroKey)) at = k;
            heroIdx = at >= 0 ? at : Math.min(heroIdx, deck.size() - 1);
            LinearLayout col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL);
            TextView hd = text(12, .7f); hd.setText("CONTINUE WATCHING"); hd.setPadding(dp(6), 0, 0, dp(4)); hd.setLetterSpacing(.12f); col.addView(hd);
            final LinearLayout hero = new LinearLayout(this); hero.setOrientation(LinearLayout.VERTICAL); hero.setPadding(dp(6), dp(5), dp(10), dp(5)); hero.setTag("hero"); hero.setFocusable(true); hero.setClickable(true);
            final ImageView img = new ImageView(this); img.setScaleType(ImageView.ScaleType.CENTER_CROP);
            GradientDrawable ph = new GradientDrawable(); ph.setColor(0x33FFFFFF); ph.setCornerRadius(dp(10)); img.setBackground(ph); img.setClipToOutline(true);
            final FrameLayout art = new FrameLayout(this); art.setClipToOutline(true); art.setBackground(ph); // the panel puts the show's name over the bottom of the picture
            art.addView(img, -1, -1);
            View shade = new View(this); shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, new int[]{0xE0140A06, 0}));
            art.addView(shade, new FrameLayout.LayoutParams(-1, dp(110), Gravity.BOTTOM));
            final ImageView logo = new ImageView(this); logo.setScaleType(ImageView.ScaleType.FIT_START); logo.setAdjustViewBounds(true);
            FrameLayout.LayoutParams ll = new FrameLayout.LayoutParams(dp(250), dp(70), Gravity.BOTTOM | Gravity.START); ll.setMargins(dp(16), 0, 0, dp(14)); art.addView(logo, ll);
            final TextView name = text(26, 1f); name.setTypeface(Typeface.create("sans-serif-condensed", Typeface.BOLD)); name.setAllCaps(true); name.setMaxLines(2);
            name.setShadowLayer(dp(3), 0, dp(1), 0xCC000000);
            FrameLayout.LayoutParams nl = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM | Gravity.START); nl.setMargins(dp(16), 0, dp(16), dp(12)); art.addView(name, nl);
            hero.addView(art, dp(420), dp(236));
            LinearLayout tx = new LinearLayout(this); tx.setOrientation(LinearLayout.VERTICAL); tx.setPadding(dp(2), dp(8), 0, 0);
            final TextView title = text(22, 1f), sub = text(15, .85f), note = text(14, .65f), dots = text(13, .8f);
            title.setMaxLines(1); title.setEllipsize(android.text.TextUtils.TruncateAt.END); // the name is on the picture; this line is the episode
            sub.setMaxLines(1); sub.setEllipsize(android.text.TextUtils.TruncateAt.END); note.setMaxLines(1); note.setEllipsize(android.text.TextUtils.TruncateAt.END);
            final FrameLayout bar = new FrameLayout(this); final View fill = new View(this);
            GradientDrawable tr = new GradientDrawable(); tr.setColor(0x33FFFFFF); tr.setCornerRadius(dp(2)); bar.setBackground(tr);
            GradientDrawable fg = new GradientDrawable(); fg.setColor(gold | 0xFF000000); fg.setCornerRadius(dp(2)); fill.setBackground(fg);
            bar.addView(fill, 0, dp(3));
            LinearLayout trow = new LinearLayout(this); trow.setGravity(Gravity.CENTER_VERTICAL); // page dots sit under the thumbnail's right corner
            trow.addView(title, new LinearLayout.LayoutParams(0, -2, 1f)); trow.addView(dots); tx.addView(trow);
            LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(dp(190), dp(3)); bl.topMargin = dp(8); bl.bottomMargin = dp(4);
            tx.addView(bar, bl); tx.addView(note);
            hero.addView(tx, dp(420), -2); // one-line title, bar and note keep their space when hidden: stepping the deck moves nothing
            final Runnable[] bind = new Runnable[1];
            bind[0] = () -> {
                String[] it = deck.get(heroIdx); heroKey = ident(it);
                img.setImageBitmap(stills.get(heroIdx)); title.setText(it[9]);
                Bitmap lb = logos.get(heroKey); logo.setImageBitmap(lb); logo.setVisibility(lb != null ? View.VISIBLE : View.GONE);
                name.setText(it[1]); name.setVisibility(lb == null ? View.VISIBLE : View.GONE);
                note.setText(it[12].startsWith("Resume") ? it[12] : ""); note.setVisibility(note.length() > 0 ? View.VISIBLE : View.INVISIBLE);
                bar.setVisibility(Integer.parseInt(it[10]) > 0 ? View.VISIBLE : View.INVISIBLE); // nothing to show until it has been started
                FrameLayout.LayoutParams fl = (FrameLayout.LayoutParams) fill.getLayoutParams(); fl.width = dp(190) * Math.max(0, Math.min(100, Integer.parseInt(it[10]))) / 100; fill.setLayoutParams(fl);
                StringBuilder d = new StringBuilder(); for (int k = 0; k < deck.size(); k++) d.append(k == heroIdx ? "● " : "○ "); dots.setText(d.toString().trim());
            };
            bind[0].run();
            hero.setOnFocusChangeListener((v, has) -> { // ring the thumbnail, not the whole card
                GradientDrawable ring = new GradientDrawable(); ring.setColor(0); ring.setCornerRadius(dp(10)); ring.setStroke(dp(4), gold | 0xFF000000);
                img.setForeground(has ? ring : null); });
            hero.setOnClickListener(v -> play(deck.get(heroIdx)));
            hero.setOnKeyListener((v, k, e) -> { // step through the deck; past either end the D-pad moves on as usual
                if (e.getAction() != KeyEvent.ACTION_DOWN) return false;
                if (k == KeyEvent.KEYCODE_DPAD_RIGHT && heroIdx < deck.size() - 1) { heroIdx++; bind[0].run(); return true; }
                if (k == KeyEvent.KEYCODE_DPAD_LEFT && heroIdx > 0) { heroIdx--; bind[0].run(); return true; }
                return false;
            });
            col.addView(hero); col.setGravity(Gravity.CENTER_HORIZONTAL);
            both.addView(col, new LinearLayout.LayoutParams(0, -2, 1f)); // half the box
        }
        if (picks != null) { // Movie night: three big posters and a shuffle
            showRow = null;
            LinearLayout col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL); col.setPadding(dp(20), 0, 0, 0);
            TextView hd = text(12, .7f); hd.setText("MOVIE NIGHT"); hd.setPadding(dp(6), 0, 0, dp(4)); hd.setLetterSpacing(.12f); col.addView(hd);
            for (int i = 0; i < picks.size(); i++) films.addView(poster(picks.get(i), pickPics[i], 104, 156));
            films.setGravity(Gravity.CENTER_VERTICAL); films.addView(pill("Shuffle", v -> movieNight()));
            col.addView(films);
            both.addView(col, new LinearLayout.LayoutParams(0, -2, 1f));
        } else if (films.getChildCount() + shows.getChildCount() > 0) {
            LinearLayout col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL); col.setPadding(dp(20), 0, 0, 0);
            TextView hd = text(12, .7f); hd.setText("NEW"); hd.setPadding(dp(6), 0, 0, dp(2)); hd.setLetterSpacing(.12f); col.addView(hd);
            for (int r = 0; r < 2; r++) {
                LinearLayout row = r == 0 ? films : shows;
                if (row.getChildCount() == 0) continue;
                TextView lb = text(11, .55f); lb.setText(r == 0 ? "MOVIES" : "TV"); lb.setPadding(dp(6), dp(2), 0, 0); col.addView(lb);
                HorizontalScrollView sv = new HorizontalScrollView(this); sv.setHorizontalScrollBarEnabled(false); sv.addView(row);
                col.addView(sv, -1, -2);
            }
            both.addView(col, new LinearLayout.LayoutParams(0, -2, 1f)); // the other half
        }
        if (both.getChildCount() == 0) { wantHero = false; return; }
        media.addView(both, -1, -2);
        // Focus goes back to the same poster or button; only when that is gone does it fall to the first one,
        // and then a half-made press-twice is dropped rather than landing on something else.
        View keep = wasTag == null || wantHero ? null : media.findViewWithTag(wasTag);
        if (keep != null) keep.requestFocus();
        else if (had || wantHero) { armedKey = null; media.requestFocus(); }
        wantHero = false;
    }

    void focusTint(View t, int radius) {
        final GradientDrawable f = new GradientDrawable(); f.setCornerRadius(dp(radius));
        t.setOnFocusChangeListener((v, has) -> { f.setColor((gold & 0x00FFFFFF) | 0x59000000); v.setBackground(has ? f : null); });
    }

    /** Press twice, like standby: playing wakes the projector and dims the room. */
    void play(final String[] it) {
        String key = it[0] + ident(it);
        if (!key.equals(armedKey) || System.currentTimeMillis() - armedPlay > 4000) {
            armedKey = key; armedPlay = System.currentTimeMillis();
            Toast.makeText(this, "Press again to play " + it[1], Toast.LENGTH_SHORT).show(); return;
        }
        armedKey = "";
        new Thread(() -> {
            try {
                String id = it[3];
                if (id.isEmpty()) { // a release: find the Plex copy first
                    String r = get(panelUrl(it[4].equals("movie") ? "/api/plex/movie?tmdb=" + it[6] : "/api/plex/episode?tmdb=" + it[6] + "&season=" + it[7] + "&episode=" + it[8]));
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
        try (InputStream in = getAssets().open("sprites/" + kind + ".png")) { atlas = BitmapFactory.decodeStream(in); } catch (Exception | OutOfMemoryError e) { return; }
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
        catch (Exception | OutOfMemoryError ignored) {}
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
        final int g = gen;
        new Thread(() -> {
            String line = null, newCond = null, newAccent = null; int newGold = 0;
            try { // the panel server: Home Assistant's weather plus the holiday accent, no token on this device
                JSONObject o = new JSONObject(get(panelUrl("/api/companion")));
                JSONObject a = o.getJSONObject("accent"); final String id = a.getString("id");
                final int gd = Color.parseColor(a.getString("gold"));
                JSONObject w = o.optJSONObject("weather");
                if (w != null && !w.isNull("temp")) {
                    final String c = w.getString("condition");
                    line = Math.round(w.getDouble("temp")) + w.optString("unit", "°F") + " · " + label(c) + " · North Royalton";
                    newCond = c;
                }
                newAccent = id; newGold = gd;
            } catch (Exception ignored) {}
            if (line == null) try { // older panel build or no weather entity: Open-Meteo for 44133
                JSONObject cur = new JSONObject(get("https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON
                    + "&current=temperature_2m,weather_code&temperature_unit=fahrenheit")).getJSONObject("current");
                int code = cur.getInt("weather_code");
                line = Math.round(cur.getDouble("temperature_2m")) + "°F · " + cond(code) + " · North Royalton";
                newCond = code == 0 ? "sunny" : code >= 71 && code < 78 ? "snowy" : code >= 51 && code < 70 ? "rainy" : code >= 80 && code < 90 ? "rainy" : code == 45 || code == 48 ? "fog" : "cloudy";
            } catch (Exception ignored) {}
            final String t = line, fc = newCond, fa = newAccent; final int fg = newGold;
            ui(g, () -> { if (fa != null) { accent = fa; gold = fg; } if (fc != null) cond = fc; if (t != null) wx.setText(t); setWall(0); });
        }).start();
        h.postDelayed(this, 5 * 60000);
    }};

    static String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection(); c.setConnectTimeout(6000); c.setReadTimeout(8000);
        if (c.getResponseCode() >= 300) throw new Exception("HTTP " + c.getResponseCode());
        return new String(readAll(c, 4 << 20, 15000), "UTF-8");
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

    @Override protected void onResume() { super.onResume(); gen++; wantHero = true; picks = null; loadInputs(); h.removeCallbacks(nowTick); nowTick.run(); tick.run(); weather.run(); h.removeCallbacks(mediaTick); mediaTick.run(); h.removeCallbacks(walker); h.postDelayed(walker, 6000); }
    @Override protected void onPause() { super.onPause(); gen++; h.removeCallbacksAndMessages(null); roam.removeAllViews(); }
}
