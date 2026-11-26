package ir.owqat.prayertimes;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * All native logic: stored schedule, single-alarm chain, alarm notification + ringtone,
 * and silent/vibrate switching with restore. No Capacitor dependency (usable from receivers).
 */
final class OwqatCore {
    private OwqatCore() {}

    static final long RING_MS = 8000;          // how long the ringtone plays
    private static final long LEAD_MS = 1500;  // events this close to now are processed together
    private static final long STALE_MS = 5 * 60 * 1000; // notifications older than this are dropped

    private static final String PREFS = "owqat_native";
    private static final String K_EVENTS = "events";
    private static final String K_MODE = "silentMode";
    private static final String K_LAST = "lastProcessedAt";
    private static final String K_ACTIVE = "silentActive";
    private static final String K_UNTIL = "silentUntil";
    private static final String K_PREV = "prevRinger";
    private static final String K_WESET = "weSet";

    static final String CH_ALARM = "owqat_alarm";
    static final String CH_ALARM_QUIET = "owqat_alarm_quiet";
    private static final String CH_INFO = "owqat_info";
    private static final int ID_SILENT = 9001;
    private static final int REQ_ALARM = 7001;
    private static final int REQ_OPEN = 7002;
    private static final String ACTION_ALARM = "ir.owqat.prayertimes.ALARM";
    private static final long[] VIBRATION = {0, 600, 400, 600, 400, 600};

    /** True while the web UI is in the foreground (it plays its own audio); set by the plugin. */
    static volatile boolean appVisible = false;

    private static MediaPlayer player;
    private static PowerManager.WakeLock wakeLock;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Runnable STOP_RING = new Runnable() {
        @Override
        public void run() {
            stopRing();
        }
    };

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ------------------------------------------------------------------ schedule

    /** Replace the stored schedule; returns the number of future events. */
    static int setSchedule(Context ctx, String eventsJson, String silentMode) {
        long now = System.currentTimeMillis();
        JSONArray clean = new JSONArray();
        int future = 0;
        try {
            JSONArray in = new JSONArray(eventsJson);
            for (int i = 0; i < in.length(); i++) {
                JSONObject e = in.optJSONObject(i);
                if (e == null) continue;
                long at = e.optLong("at", 0);
                String type = e.optString("type", "");
                if (at <= 0 || !isKnownType(type)) continue;
                JSONObject c = new JSONObject();
                c.put("at", at);
                c.put("type", type);
                c.put("title", e.optString("title", ""));
                c.put("body", e.optString("body", ""));
                long until = e.optLong("until", 0);
                if (until > 0) c.put("until", until);
                clean.put(c);
                if (at > now) future++;
            }
        } catch (JSONException ignored) {
            // keep what we collected so far
        }
        SharedPreferences p = prefs(ctx);
        long last = p.getLong(K_LAST, 0);
        // keep "already processed" marker inside [now, now+LEAD] so nothing fires twice
        last = Math.max(now, Math.min(last, now + LEAD_MS));
        p.edit()
            .putString(K_EVENTS, clean.toString())
            .putString(K_MODE, "vibrate".equals(silentMode) ? "vibrate" : "silent")
            .putLong(K_LAST, last)
            .commit();
        checkExpired(ctx, now);
        arm(ctx);
        return future;
    }

    static void cancelAll(Context ctx) {
        prefs(ctx).edit().putString(K_EVENTS, "[]").commit();
        cancelAlarm(ctx);
        silentOff(ctx); // do not leave the phone silent without a pending restore
    }

    private static boolean isKnownType(String t) {
        return "pre".equals(t) || "azan".equals(t) || "iqama".equals(t)
            || "silentOn".equals(t) || "silentOff".equals(t);
    }

    static void clampLastProcessed(Context ctx) {
        SharedPreferences p = prefs(ctx);
        long now = System.currentTimeMillis();
        if (p.getLong(K_LAST, 0) > now + LEAD_MS) p.edit().putLong(K_LAST, now).commit();
    }

    /** Arm exactly one alarm: the next unprocessed event, or the silent expiry if sooner. */
    static void arm(Context ctx) {
        long now = System.currentTimeMillis();
        SharedPreferences p = prefs(ctx);
        long last = p.getLong(K_LAST, 0);
        long floor = Math.max(now, last);
        long next = 0;
        JSONArray arr = loadEvents(ctx);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject e = arr.optJSONObject(i);
            if (e == null) continue;
            long at = e.optLong("at", 0);
            if (at > floor && (next == 0 || at < next)) next = at;
        }
        if (p.getBoolean(K_ACTIVE, false)) {
            long until = p.getLong(K_UNTIL, 0);
            if (until > now && (next == 0 || until < next)) next = until;
        }
        if (next == 0) {
            cancelAlarm(ctx);
            return;
        }
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = alarmPendingIntent(ctx);
        boolean done = false;
        if (canExact(ctx)) {
            try {
                if (Build.VERSION.SDK_INT >= 23) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, next, pi);
                }
                done = true;
            } catch (SecurityException ignored) {
                // permission revoked meanwhile: fall back below
            }
        }
        if (!done) {
            // setAlarmClock needs no permission and is exempt from Doze
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(next, openAppIntent(ctx)), pi);
        }
    }

    private static void cancelAlarm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmPendingIntent(ctx));
    }

    private static PendingIntent alarmPendingIntent(Context ctx) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction(ACTION_ALARM);
        return PendingIntent.getBroadcast(ctx, REQ_ALARM, i,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent openAppIntent(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, REQ_OPEN, i,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static JSONArray loadEvents(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(K_EVENTS, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    // ------------------------------------------------------------------ processing

    /** Handle every event due now (+LEAD). Returns true if a ringtone was started. */
    static boolean process(Context ctx) {
        long now = System.currentTimeMillis();
        checkExpired(ctx, now);
        SharedPreferences p = prefs(ctx);
        long last = p.getLong(K_LAST, 0);
        long cutoff = now + LEAD_MS;
        JSONArray arr = loadEvents(ctx);
        List<JSONObject> due = new ArrayList<JSONObject>();
        long maxAt = last;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject e = arr.optJSONObject(i);
            if (e == null) continue;
            long at = e.optLong("at", 0);
            if (at > last && at <= cutoff) {
                due.add(e);
                if (at > maxAt) maxAt = at;
            }
        }
        if (due.isEmpty()) return false;
        // mark first so a crash below can never cause a re-fire loop
        p.edit().putLong(K_LAST, maxAt).commit();
        Collections.sort(due, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                return Long.compare(a.optLong("at"), b.optLong("at"));
            }
        });
        boolean rang = false;
        for (JSONObject e : due) {
            long at = e.optLong("at");
            String type = e.optString("type");
            if ("silentOff".equals(type)) {
                silentOff(ctx);
            } else if ("silentOn".equals(type)) {
                long until = e.optLong("until", 0);
                if (until > 0 && until <= now) continue; // window already over
                silentOn(ctx, until);
            } else if (now - at <= STALE_MS) { // pre / azan / iqama
                alarm(ctx, e.optString("title"), e.optString("body"), notificationId(at, type));
                rang = rang || !appVisible;
            }
        }
        return rang;
    }

    private static int notificationId(long at, String type) {
        int idx = "pre".equals(type) ? 0 : "azan".equals(type) ? 1 : 2;
        return (int) ((at / 60000L) % 1000000L) * 4 + idx;
    }

    // ------------------------------------------------------------------ alarm (notification + sound)

    /** Used by testAlarm: fires immediately. */
    static void alarmNow(Context ctx, String title, String body) {
        alarm(ctx, title, body, 9002);
    }

    private static Uri alarmUri() {
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        return u;
    }

    private static AudioAttributes alarmAttrs() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    private static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CH_ALARM, "Alarms", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Prayer time alarms");
        ch.setSound(alarmUri(), alarmAttrs()); // alarm stream: audible even in silent ringer mode
        ch.enableVibration(true);
        ch.setVibrationPattern(VIBRATION);
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
        NotificationChannel quiet = new NotificationChannel(CH_ALARM_QUIET, "Alarms (app open)", NotificationManager.IMPORTANCE_DEFAULT);
        quiet.setSound(null, null);
        quiet.enableVibration(false);
        quiet.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(quiet);
        NotificationChannel info = new NotificationChannel(CH_INFO, "Status", NotificationManager.IMPORTANCE_LOW);
        info.setSound(null, null);
        nm.createNotificationChannel(info);
    }

    private static Notification.Builder builder(Context ctx, String channel) {
        if (Build.VERSION.SDK_INT >= 26) return new Notification.Builder(ctx, channel);
        return new Notification.Builder(ctx);
    }

    @SuppressWarnings("deprecation")
    private static void alarm(Context ctx, String title, String body, int id) {
        final boolean quiet = appVisible; // foreground: the page plays its own audio
        try {
            ensureChannels(ctx);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            PendingIntent open = openAppIntent(ctx);
            Notification.Builder b = builder(ctx, quiet ? CH_ALARM_QUIET : CH_ALARM)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setWhen(System.currentTimeMillis());
            if (Build.VERSION.SDK_INT < 26) {
                if (quiet) {
                    b.setPriority(Notification.PRIORITY_DEFAULT);
                    b.setSound(null, null);
                } else {
                    b.setPriority(Notification.PRIORITY_MAX);
                    b.setSound(alarmUri(), alarmAttrs());
                    b.setVibrate(VIBRATION);
                }
            }
            if (!quiet) {
                try {
                    b.setFullScreenIntent(open, true);
                } catch (Throwable ignored) {
                    // may be denied on Android 14+
                }
            }
            if (nm != null) nm.notify(id, b.build());
        } catch (Throwable ignored) {
            // still try to ring below
        }
        if (!quiet) ring(ctx);
    }

    @SuppressWarnings("deprecation")
    private static void ring(Context ctx) {
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                if (wakeLock == null) wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "owqat:alarm");
                wakeLock.acquire(RING_MS + 2000);
            }
        } catch (Throwable ignored) {
        }
        stopRing();
        try {
            Uri uri = alarmUri();
            if (uri != null) {
                MediaPlayer mp = new MediaPlayer();
                mp.setAudioAttributes(alarmAttrs());
                mp.setDataSource(ctx, uri);
                mp.setLooping(false);
                mp.prepare();
                mp.start();
                player = mp;
            }
        } catch (Throwable t) {
            releasePlayer();
        }
        try {
            Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= 26) {
                    v.vibrate(VibrationEffect.createWaveform(VIBRATION, -1), alarmAttrs());
                } else {
                    v.vibrate(VIBRATION, -1, alarmAttrs());
                }
            }
        } catch (Throwable ignored) {
        }
        MAIN.removeCallbacks(STOP_RING);
        MAIN.postDelayed(STOP_RING, RING_MS);
    }

    private static void releasePlayer() {
        MediaPlayer mp = player;
        player = null;
        if (mp != null) {
            try {
                if (mp.isPlaying()) mp.stop();
            } catch (Throwable ignored) {
            }
            try {
                mp.release();
            } catch (Throwable ignored) {
            }
        }
    }

    private static void stopRing() {
        releasePlayer();
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) {
        }
    }

    // ------------------------------------------------------------------ silent mode

    static void silentOn(Context ctx, long until) {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        SharedPreferences p = prefs(ctx);
        int target = "vibrate".equals(p.getString(K_MODE, "silent"))
            ? AudioManager.RINGER_MODE_VIBRATE : AudioManager.RINGER_MODE_SILENT;
        boolean active = p.getBoolean(K_ACTIVE, false);
        int prev = active ? p.getInt(K_PREV, AudioManager.RINGER_MODE_NORMAL) : am.getRingerMode();
        try {
            am.setRingerMode(target);
        } catch (SecurityException e) {
            // no Do-Not-Disturb access: SILENT is refused, VIBRATE needs no policy access
            try {
                am.setRingerMode(AudioManager.RINGER_MODE_VIBRATE);
            } catch (Throwable ignored) {
            }
        }
        int now = am.getRingerMode(); // what actually took effect (some ROMs convert modes)
        p.edit()
            .putBoolean(K_ACTIVE, true)
            .putLong(K_UNTIL, until)
            .putInt(K_PREV, prev)
            .putInt(K_WESET, now)
            .commit();
        if (until > 0) quietNotice(ctx, until);
    }

    /** Idempotent: restores the previous ringer only if the user did not change it meanwhile. */
    static void silentOff(Context ctx) {
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean(K_ACTIVE, false)) return;
        int weSet = p.getInt(K_WESET, -1);
        int prev = p.getInt(K_PREV, AudioManager.RINGER_MODE_NORMAL);
        p.edit().putBoolean(K_ACTIVE, false).putLong(K_UNTIL, 0).commit();
        try {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am != null && am.getRingerMode() == weSet) am.setRingerMode(prev);
        } catch (Throwable ignored) {
        }
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(ID_SILENT);
        } catch (Throwable ignored) {
        }
    }

    /** If we silenced the phone and the stored end time has passed, restore now. */
    static void checkExpired(Context ctx, long now) {
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean(K_ACTIVE, false)) return;
        long until = p.getLong(K_UNTIL, 0);
        if (until > 0 && until <= now) silentOff(ctx);
    }

    private static void quietNotice(Context ctx, long until) {
        try {
            ensureChannels(ctx);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            String hhmm = new SimpleDateFormat("HH:mm", Locale.US).format(new Date(until));
            Notification.Builder b = builder(ctx, CH_INFO)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle("گوشی بی‌صدا شد")
                .setContentText("تا " + hhmm)
                .setContentIntent(openAppIntent(ctx))
                .setAutoCancel(true);
            if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_LOW);
            if (nm != null) nm.notify(ID_SILENT, b.build());
        } catch (Throwable ignored) {
        }
    }

    // ------------------------------------------------------------------ status

    static boolean notificationsGranted(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(ctx, "android.permission.POST_NOTIFICATIONS")
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
        }
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    static boolean dndAccess(Context ctx) {
        if (Build.VERSION.SDK_INT < 23) return true;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }

    static boolean canExact(Context ctx) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    static boolean isSilentActive(Context ctx) {
        return prefs(ctx).getBoolean(K_ACTIVE, false);
    }
}
