package ir.owqat.prayertimes;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// JS bridge: window.Capacitor.Plugins.OwqatNative
@CapacitorPlugin(
    name = "OwqatNative",
    permissions = {
        @Permission(strings = {"android.permission.POST_NOTIFICATIONS"}, alias = "notifications")
    }
)
public class OwqatNativePlugin extends Plugin {

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        OwqatCore.appVisible = true;
    }

    @Override
    protected void handleOnPause() {
        OwqatCore.appVisible = false;
        super.handleOnPause();
    }

    @PluginMethod
    public void setSchedule(PluginCall call) {
        JSArray events = call.getArray("events");
        String json = events == null ? "[]" : events.toString();
        String mode = call.getString("silentMode", "silent");
        int count = OwqatCore.setSchedule(getContext(), json, mode);
        JSObject ret = new JSObject();
        ret.put("scheduled", count);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        OwqatCore.cancelAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("platform", "android");
        ret.put("notifications", OwqatCore.notificationsGranted(getContext()));
        ret.put("dndAccess", OwqatCore.dndAccess(getContext()));
        ret.put("exactAlarm", OwqatCore.canExact(getContext()));
        ret.put("silentActive", OwqatCore.isSilentActive(getContext()));
        ret.put("appVisible", OwqatCore.appVisible);
        call.resolve(ret);
    }

    @PluginMethod
    public void openDndSettings(PluginCall call) {
        launch(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
        call.resolve();
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            launch(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:" + getContext().getPackageName())));
        }
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || OwqatCore.notificationsGranted(getContext())) {
            resolveGranted(call);
            return;
        }
        // Capacitor wraps ActivityCompat.requestPermissions and gives us a callback with the result.
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        resolveGranted(call);
    }

    @PluginMethod
    public void testAlarm(PluginCall call) {
        String title = call.getString("title", "Test");
        String body = call.getString("body", "");
        OwqatCore.alarmNow(getContext(), title, body);
        call.resolve();
    }

    private void resolveGranted(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", OwqatCore.notificationsGranted(getContext()));
        call.resolve(ret);
    }

    private void launch(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Throwable ignored) {
            // settings screen not available on this device
        }
    }
}
