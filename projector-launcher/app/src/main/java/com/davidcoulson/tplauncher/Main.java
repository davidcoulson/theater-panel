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
    static final double LAT = 41.3136, LON = -81.7240; // 44133 North Royalton, OH
    ImageView wall; TextView time, date, wx; String[] walls; int wallIdx;
    SharedPreferences prefs; final Handler h = new Handler();

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("tp", MODE_PRIVATE);
        try { walls = getAssets().list("wallpapers"); } catch (Exception e) { walls = new String[0]; }
        wallIdx = prefs.getInt("wall", 0) % Math.max(1, walls.length);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        wall = new ImageView(this); wall.setScaleType(ImageView.ScaleType.CENTER_CROP);
        root.addView(wall, -1, -1);

        LinearLayout top = new LinearLayout(this); top.setOrientation(LinearLayout.VERTICAL);
        top.setPadding(dp(64), dp(40), 0, 0);
        time = text(64, 1f); date = text(22, .8f); wx = text(22, .8f);
        top.addView(time); top.addView(date); top.addView(wx);
        root.addView(top, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START));

        dock = new LinearLayout(this); dock.setOrientation(LinearLayout.HORIZONTAL);
        dock.setPadding(dp(20), dp(14), dp(20), dp(14)); dock.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(0x4D1E2630); bg.setCornerRadius(dp(34)); dock.setBackground(bg);
        fill(FALLBACK);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lp.bottomMargin = dp(48);
        root.addView(dock, lp);
        corner = new LinearLayout(this); corner.setPadding(0, dp(36), dp(56), 0);
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
                org.json.JSONArray src = new JSONObject(new java.util.Scanner(c.getInputStream()).useDelimiter("\\A").next()).getJSONArray("sources");
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
    void pick(final String id, final String name) { post("{\"action\":\"game_source\",\"id\":\"" + id + "\"}", name); }

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
                msg = code < 300 ? name : name + " failed (" + code + ")";
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
        c.setOnFocusChangeListener((v, has) -> v.setBackground(has ? f : null));
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
        if (code == KeyEvent.KEYCODE_DPAD_UP && !corner.hasFocus()) { corner.getChildAt(corner.getChildCount() - 1).requestFocus(); return true; }
        if (code == KeyEvent.KEYCODE_DPAD_DOWN && corner.hasFocus()) { dock.getChildAt(0).requestFocus(); return true; }
        if (code == KeyEvent.KEYCODE_BACK) return true; // a launcher has nowhere to go back to
        return super.onKeyDown(code, e);
    }

    void setWall(int d) {
        if (walls.length == 0) return;
        wallIdx = (wallIdx + d + walls.length) % walls.length;
        prefs.edit().putInt("wall", wallIdx).apply();
        try (InputStream in = getAssets().open("wallpapers/" + walls[wallIdx])) {
            wall.setImageBitmap(BitmapFactory.decodeStream(in));
        } catch (Exception ignored) {}
    }

    final Runnable tick = new Runnable() { public void run() {
        Date n = new Date();
        time.setText(new SimpleDateFormat("h:mm", Locale.US).format(n));
        date.setText(new SimpleDateFormat("EEEE, MMMM d", Locale.US).format(n));
        h.postDelayed(this, 10000);
    }};
    final Runnable weather = new Runnable() { public void run() {
        new Thread(() -> {
            try {
                URL u = new URL("https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON
                    + "&current=temperature_2m,weather_code&temperature_unit=fahrenheit");
                HttpURLConnection c = (HttpURLConnection) u.openConnection(); c.setConnectTimeout(8000); c.setReadTimeout(8000);
                java.util.Scanner s = new java.util.Scanner(c.getInputStream()).useDelimiter("\\A");
                JSONObject cur = new JSONObject(s.next()).getJSONObject("current");
                final String t = Math.round(cur.getDouble("temperature_2m")) + "°F · " + cond(cur.getInt("weather_code")) + " · North Royalton";
                runOnUiThread(() -> wx.setText(t));
            } catch (Exception ignored) {}
        }).start();
        h.postDelayed(this, 15 * 60000);
    }};

    static String cond(int c) {
        if (c == 0) return "Clear"; if (c <= 2) return "Partly cloudy"; if (c == 3) return "Cloudy";
        if (c == 45 || c == 48) return "Fog"; if (c < 60) return "Drizzle"; if (c < 70) return "Rain";
        if (c < 80) return "Snow"; if (c < 90) return "Showers"; return "Storms";
    }

    @Override protected void onResume() { super.onResume(); tick.run(); weather.run(); }
    @Override protected void onPause() { super.onPause(); h.removeCallbacksAndMessages(null); }
}
