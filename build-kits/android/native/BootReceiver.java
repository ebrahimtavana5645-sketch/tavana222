package ir.owqat.prayertimes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Re-arms the chain after reboot / app update / clock or timezone change.
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            String action = intent == null ? null : intent.getAction();
            if (Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
                OwqatCore.clampLastProcessed(context);
            }
            OwqatCore.checkExpired(context, System.currentTimeMillis());
            OwqatCore.arm(context);
        } catch (Throwable ignored) {
        }
    }
}
