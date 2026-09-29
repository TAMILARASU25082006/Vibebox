package com.vibebox.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Request Notification Permission programmatically for Android 13+ (Required for Background Service)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        
        // Force the WebView to resume so JS and media playback continue when app is minimized
        if (this.getBridge() != null && this.getBridge().getWebView() != null) {
            this.getBridge().getWebView().onResume();
        }
    }
}
