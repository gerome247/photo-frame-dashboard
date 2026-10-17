package com.photoframe.homebutton;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.os.IBinder;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

public final class HomeService extends Service {
    private WindowManager windows;
    private WindowManager.LayoutParams position;
    private View button;
    private SharedPreferences preferences;
    private int size;
    private float downX, downY;
    private int initialX, initialY;
    private boolean dragging;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        preferences = getSharedPreferences("home", 0);
        if (!preferences.getBoolean("enabled", true) || !Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel("home", "Home button",
                NotificationManager.IMPORTANCE_LOW));
        PendingIntent settings = PendingIntent.getActivity(this, 0,
                new Intent(this, HomeSettingsActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        startForeground(1, new Notification.Builder(this, "home")
                .setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("Frame Home")
                .setContentText("Tap the floating house to return to Home")
                .setContentIntent(settings).setOngoing(true).build());
        if (button != null) return START_STICKY;
        windows = getSystemService(WindowManager.class);
        float density = getResources().getDisplayMetrics().density;
        size = Math.round(56 * density);
        DisplayMetrics metrics = new DisplayMetrics();
        windows.getDefaultDisplay().getRealMetrics(metrics);
        position = new WindowManager.LayoutParams(size, size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        position.gravity = Gravity.TOP | Gravity.LEFT;
        position.x = preferences.getInt("x", metrics.widthPixels - size - Math.round(16 * density));
        position.y = preferences.getInt("y", metrics.heightPixels - size - Math.round(16 * density));
        clampPosition();
        button = new View(this) {
            private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            @Override protected void onDraw(Canvas canvas) {
                super.onDraw(canvas);
                canvas.save();
                canvas.scale(getWidth() / 56f, getHeight() / 56f);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.rgb(23, 61, 73));
                canvas.drawCircle(28, 28, 27, paint);
                paint.setColor(Color.WHITE);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(2.5f);
                paint.setStrokeJoin(Paint.Join.ROUND);
                Path house = new Path();
                house.moveTo(14, 26); house.lineTo(28, 14); house.lineTo(42, 26);
                house.moveTo(18, 23); house.lineTo(18, 40); house.lineTo(25, 40);
                house.lineTo(25, 31); house.lineTo(31, 31); house.lineTo(31, 40);
                house.lineTo(38, 40); house.lineTo(38, 23);
                canvas.drawPath(house, paint);
                canvas.restore();
            }
        };
        button.setContentDescription("Home. Drag to move.");
        button.setOnClickListener(view -> goHome());
        button.setOnTouchListener((view, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = event.getRawX(); downY = event.getRawY();
                    initialX = position.x; initialY = position.y;
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = event.getRawX() - downX, dy = event.getRawY() - downY;
                    if (dx * dx + dy * dy > 64 * density * density) dragging = true;
                    if (dragging) {
                        position.x = initialX + Math.round(dx);
                        position.y = initialY + Math.round(dy);
                        clampPosition();
                        windows.updateViewLayout(button, position);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (dragging) savePosition(); else view.performClick();
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    if (dragging) savePosition();
                    return true;
                default: return true;
            }
        });
        windows.addView(button, position);
        return START_STICKY;
    }

    private void goHome() {
        startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private void clampPosition() {
        DisplayMetrics metrics = new DisplayMetrics();
        windows.getDefaultDisplay().getRealMetrics(metrics);
        position.x = Math.max(0, Math.min(position.x, metrics.widthPixels - size));
        position.y = Math.max(0, Math.min(position.y, metrics.heightPixels - size));
    }
    private void savePosition() {
        preferences.edit().putInt("x", position.x).putInt("y", position.y).apply();
    }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (button != null) {
            clampPosition();
            windows.updateViewLayout(button, position);
        }
    }
    @Override public void onDestroy() {
        if (button != null) {
            windows.removeView(button);
            button = null;
        }
        stopForeground(true);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
