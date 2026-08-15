package io.starfit.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class PermissionUtils {
    private static final String TAG = "PermissionUtils";
    public static final int PERMISSION_REQUEST_CODE = 1001;

    // Static listener storage
    private static OnPermissionResultListener permissionListener;

    private static Map<String, String> permissionRationales = new HashMap<>();
    
    static {
        permissionRationales.put(Manifest.permission.ACCESS_FINE_LOCATION, 
            "应用需要访问您的精确位置以提供准确的定位服务");
        permissionRationales.put(Manifest.permission.ACCESS_COARSE_LOCATION, 
            "应用需要访问您的大概位置以提供基本的定位服务");
        permissionRationales.put(Manifest.permission.ACCESS_BACKGROUND_LOCATION, 
            "应用需要后台位置权限以在后台持续追踪您的运动轨迹");
        permissionRationales.put(Manifest.permission.READ_EXTERNAL_STORAGE, 
            "应用需要读取外部存储权限以访问您的照片和视频");
        permissionRationales.put(Manifest.permission.WRITE_EXTERNAL_STORAGE, 
            "应用需要写入外部存储权限以保存您的运动记录和媒体文件");
        permissionRationales.put(Manifest.permission.READ_MEDIA_IMAGES, 
            "应用需要访问图片权限以选择和上传您的运动照片");
        permissionRationales.put(Manifest.permission.READ_MEDIA_VIDEO, 
            "应用需要访问视频权限以选择和上传您的运动视频");
        permissionRationales.put(Manifest.permission.READ_MEDIA_AUDIO, 
            "应用需要访问音频权限以选择和上传您的运动音频");
        permissionRationales.put(Manifest.permission.CAMERA, 
            "应用需要相机权限以拍摄您的运动照片和视频");
    }
    
    public static class PermissionResult {
        public final boolean allGranted;
        public final List<String> grantedPermissions;
        public final List<String> deniedPermissions;
        public final List<String> permanentlyDeniedPermissions;
        
        public PermissionResult(boolean allGranted, List<String> granted, 
                               List<String> denied, List<String> permanentlyDenied) {
            this.allGranted = allGranted;
            this.grantedPermissions = granted;
            this.deniedPermissions = denied;
            this.permanentlyDeniedPermissions = permanentlyDenied;
        }
    }
    
    public static boolean hasPermission(Context context, String permission) {
        return ContextCompat.checkSelfPermission(context, permission) 
            == PackageManager.PERMISSION_GRANTED;
    }
    
    public static boolean hasPermissions(Context context, String[] permissions) {
        for (String permission : permissions) {
            if (!hasPermission(context, permission)) {
                return false;
            }
        }
        return true;
    }
    
    public static boolean shouldShowRationale(Activity activity, String permission) {
        return ActivityCompat.shouldShowRequestPermissionRationale(activity, permission);
    }
    
    public static void requestPermissions(Activity activity, String[] permissions,
                                         OnPermissionResultListener listener) {
        List<String> permissionsToRequest = new ArrayList<>();

        for (String permission : permissions) {
            if (!hasPermission(activity, permission)) {
                permissionsToRequest.add(permission);
            }
        }

        if (permissionsToRequest.isEmpty()) {
            if (listener != null) {
                PermissionResult result = new PermissionResult(true,
                    new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
                listener.onPermissionResult(result);
            }
            return;
        }

        // Store listener in static field
        permissionListener = listener;

        String[] requestArray = permissionsToRequest.toArray(new String[0]);

        ActivityCompat.requestPermissions(activity, requestArray, PERMISSION_REQUEST_CODE);
    }

    public static OnPermissionResultListener getPermissionListener() {
        return permissionListener;
    }

    public static void clearPermissionListener() {
        permissionListener = null;
    }
    
    public static PermissionResult handlePermissionResult(Context context, 
                                                         String[] permissions, 
                                                         int[] grantResults) {
        List<String> granted = new ArrayList<>();
        List<String> denied = new ArrayList<>();
        List<String> permanentlyDenied = new ArrayList<>();
        
        Activity activity = (Activity) context;
        
        for (int i = 0; i < permissions.length; i++) {
            String permission = permissions[i];
            int result = grantResults[i];
            
            if (result == PackageManager.PERMISSION_GRANTED) {
                granted.add(permission);
            } else {
                denied.add(permission);
                if (!shouldShowRationale(activity, permission)) {
                    permanentlyDenied.add(permission);
                }
            }
        }
        
        boolean allGranted = denied.isEmpty();
        
        return new PermissionResult(allGranted, granted, denied, permanentlyDenied);
    }
    
    public static String[] getLocationPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            };
        } else {
            return new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            };
        }
    }
    
    public static String[] getStoragePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return new String[]{
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_AUDIO
            };
        } else {
            return new String[]{
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            };
        }
    }
    
    public static String[] getCameraPermissions() {
        return new String[]{Manifest.permission.CAMERA};
    }
    
    public static String[] getAllRequiredPermissions() {
        List<String> allPermissions = new ArrayList<>();
        
        for (String permission : getLocationPermissions()) {
            allPermissions.add(permission);
        }
        
        for (String permission : getStoragePermissions()) {
            if (!allPermissions.contains(permission)) {
                allPermissions.add(permission);
            }
        }
        
        allPermissions.add(Manifest.permission.CAMERA);
        
        return allPermissions.toArray(new String[0]);
    }
    
    public static String getRationale(String permission) {
        return permissionRationales.get(permission);
    }
    
    public static boolean isAllPermissionsGranted(Context context) {
        return hasPermissions(context, getAllRequiredPermissions());
    }
    
    public interface OnPermissionResultListener {
        void onPermissionResult(PermissionResult result);
    }
}