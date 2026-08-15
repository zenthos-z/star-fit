package io.starfit.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;

import com.getcapacitor.BridgeActivity;

import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static final String[] REQUIRED_PERMISSIONS = PermissionUtils.getAllRequiredPermissions();
    private boolean permissionsRequested = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        checkAndRequestPermissions();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == PermissionUtils.PERMISSION_REQUEST_CODE) {
            PermissionUtils.PermissionResult result = PermissionUtils.handlePermissionResult(
                this, permissions, grantResults);

            // Get and notify the stored listener
            PermissionUtils.OnPermissionResultListener listener = PermissionUtils.getPermissionListener();
            if (listener != null) {
                listener.onPermissionResult(result);
                PermissionUtils.clearPermissionListener();
            }

            if (result.allGranted) {
                Log.d(TAG, "所有权限已授予");
                Toast.makeText(this, "所有权限已授予", Toast.LENGTH_SHORT).show();
            } else {
                Log.d(TAG, "部分权限未授予");
                handleDeniedPermissions(result);
            }

            permissionsRequested = true;
        }
    }

    private void checkAndRequestPermissions() {
        if (PermissionUtils.isAllPermissionsGranted(this)) {
            Log.d(TAG, "所有权限已授予");
            permissionsRequested = true;
            return;
        }

        if (permissionsRequested) {
            Log.d(TAG, "权限已经请求过，不再重复请求");
            return;
        }

        if (shouldShowPermissionRationale()) {
            showPermissionRationaleDialog();
        } else {
            requestAllPermissions();
        }
    }

    private boolean shouldShowPermissionRationale() {
        for (String permission : REQUIRED_PERMISSIONS) {
            if (!PermissionUtils.hasPermission(this, permission) && 
                PermissionUtils.shouldShowRationale(this, permission)) {
                return true;
            }
        }
        return false;
    }

    private void showPermissionRationaleDialog() {
        new AlertDialog.Builder(this)
            .setTitle("权限请求")
            .setMessage("应用需要以下权限才能正常运行：\n\n" +
                "• 位置权限 - 用于GPS定位和运动轨迹记录\n" +
                "• 存储权限 - 用于保存和访问您的运动数据、照片和视频\n" +
                "• 相机权限 - 用于拍摄运动照片和视频\n\n" +
                "请点击\"授权\"以授予这些权限。")
            .setPositiveButton("授权", (dialog, which) -> {
                requestAllPermissions();
            })
            .setNegativeButton("取消", (dialog, which) -> {
                Toast.makeText(this, "部分功能可能无法正常使用", Toast.LENGTH_LONG).show();
                permissionsRequested = true;
            })
            .setCancelable(false)
            .show();
    }

    private void requestAllPermissions() {
        PermissionUtils.requestPermissions(this, REQUIRED_PERMISSIONS, 
            new PermissionUtils.OnPermissionResultListener() {
                @Override
                public void onPermissionResult(PermissionUtils.PermissionResult result) {
                    if (!result.allGranted) {
                        handleDeniedPermissions(result);
                    }
                }
            });
    }

    private void handleDeniedPermissions(PermissionUtils.PermissionResult result) {
        StringBuilder message = new StringBuilder();
        
        if (!result.deniedPermissions.isEmpty()) {
            message.append("以下权限未授予：\n");
            for (String permission : result.deniedPermissions) {
                String rationale = PermissionUtils.getRationale(permission);
                if (rationale != null) {
                    message.append("• ").append(rationale).append("\n");
                }
            }
        }
        
        if (!result.permanentlyDeniedPermissions.isEmpty()) {
            message.append("\n以下权限被永久拒绝，需要在设置中手动开启：\n");
            for (String permission : result.permanentlyDeniedPermissions) {
                message.append("• ").append(permission).append("\n");
            }
            
            message.append("\n请在应用设置中手动开启这些权限");
            
            new AlertDialog.Builder(this)
                .setTitle("权限需要手动开启")
                .setMessage(message.toString())
                .setPositiveButton("去设置", (dialog, which) -> {
                    openAppSettings();
                })
                .setNegativeButton("稍后", (dialog, which) -> {
                    Toast.makeText(this, "部分功能可能无法正常使用", Toast.LENGTH_LONG).show();
                })
                .setCancelable(false)
                .show();
        } else {
            Toast.makeText(this, message.toString(), Toast.LENGTH_LONG).show();
        }
    }

    private void openAppSettings() {
        Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(android.net.Uri.parse("package:" + getPackageName()));
        startActivity(intent);
    }
}
