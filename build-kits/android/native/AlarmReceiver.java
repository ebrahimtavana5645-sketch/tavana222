package ir.owqat.prayertimes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

// Fired by AlarmManager for the next stored event: process everything due, then arm the next one.
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        boolean rang = false;
        try {
            rang = OwqatCore.process(context);
        } catch (Throwable ignored) {
            // never crash from a receiver
        }
        try {
            OwqatCore.arm(context);
        } catch (Throwable ignored) {
        }
        if (rang) {
            // Keep the process alive until the ringtone has been stopped and released.
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    pending.finish();
                }
            }, OwqatCore.RING_MS + 500);
        } else {
            pending.finish();
        }
    }
}
