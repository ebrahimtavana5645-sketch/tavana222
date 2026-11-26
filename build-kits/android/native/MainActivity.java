package ir.owqat.prayertimes;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

// Overwrites the default Capacitor MainActivity so the custom plugin is registered.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins must be registered BEFORE super.onCreate() (which loads the bridge).
        registerPlugin(OwqatNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
