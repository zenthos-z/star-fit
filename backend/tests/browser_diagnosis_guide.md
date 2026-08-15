# 用户画像保存问题 - 浏览器端诊断指南


## 问题描述
- 在用户管理界面编辑用户画像并保存
- 浏览器控制台显示保存成功（200 状态码）
- 但数据实际没有保存到后端
- 导出数据时看不到新填写的信息

## 已确认的事实
1. ✅ 后端数据库操作正常（通过测试验证）
2. ✅ API 路由正确注册
3. ✅ localhost 和 IP 地址的 API 请求都能正常工作
4. ✅ 服务器返回 200 状态码
5. ❌ 问题出在前端与后端的数据同步

## 诊断步骤

### 步骤 1：清除浏览器缓存
在用户管理界面，按 `Ctrl + Shift + Delete` 打开清除缓存对话框：
- 勾选"缓存的图像和文件"
- 点击"清除数据"
- 然后刷新页面

### 步骤 2：使用无痕模式测试
- 按 `Ctrl + Shift + N` 打开无痕窗口
- 访问管理界面
- 编辑用户画像并保存
- 检查是否正常

### 步骤 3：检查实际的网络请求

在浏览器中：
1. 按 `F12` 打开开发者工具
2. 切换到 `Network` 标签页
3. 勾选 `Preserve log`（保留日志）
4. 编辑用户画像并点击保存
5. 在 Network 中找到 `profiles` 相关的请求

**检查要点：**
- 请求 URL 是否正确（应该是 `http://192.168.31.100:43111/api/profiles/test20260115`）
- 请求方法是否为 `PUT`
- 请求的 `Payload`（负载）是否包含你的数据
- 响应状态码是否为 200
- 响应内容是什么

### 步骤 4：检查服务端日志

在后端服务器运行终端中，观察日志：
```
[UserProfile] Updating profile for user: test20260115
[UserProfile] Request body: {...}
```

如果看到这些日志，说明请求确实到达了后端。

### 步骤 5：直接测试 API

在浏览器控制台运行以下代码：

```javascript
// 测试 GET 请求
fetch('http://192.168.31.100:43111/api/profiles/test20260115')
  .then(r => r.json())
  .then(d => console.log('GET Response:', d));

// 测试 PUT 请求
fetch('http://192.168.31.100:43111/api/profiles/test20260115', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-User-Id': 'test20260115' },
  body: JSON.stringify({
    basic_info: { age: 99, height: 999, weight: 999 },
    preferences: { goal: '测试', duration: 30 },
    modifiedBy: 'manual_test'
  })
})
  .then(r => r.json())
  .then(d => console.log('PUT Response:', d));

// 验证更新
setTimeout(() => {
  fetch('http://192.168.31.100:43111/api/profiles/test20260115')
    .then(r => r.json())
    .then(d => console.log('Verify Response:', d));
}, 1000);
```

如果这个测试能成功保存和读取，说明 API 本身没问题，问题出在前端的实现。

### 步骤 6：检查前端缓存

在浏览器控制台运行：
```javascript
// 检查是否有缓存
console.log('LocalStorage - API_BASE:', localStorage.getItem('STARFIT_API_BASE'));
console.log('LocalStorage - Server URL:', localStorage.getItem('starfit_server_url'));
console.log('LocalStorage - User ID:', localStorage.getItem('starfit_user_id'));

// 清除所有缓存
// localStorage.clear();
// 然后刷新页面
```

### 步骤 7：检查是否有多个用户

在浏览器控制台运行：
```javascript
// 获取用户列表
fetch('http://192.168.31.100:43111/api/admin/users')
  .then(r => r.json())
  .then(users => console.log('All users:', users));
```

确认你编辑的用户 ID 是否正确。

## 可能的原因

### 原因 1：浏览器缓存旧数据
前端可能缓存了旧的用户画像数据，即使后端保存成功，前端仍显示旧数据。

**解决方案：** 清除浏览器缓存或使用无痕模式。

### 原因 2：API 请求被拦截
可能有浏览器插件或代理拦截了 PUT 请求。

**解决方案：**
- 暂时禁用所有浏览器插件
- 检查代理设置
- 直接使用 localhost 测试

### 原因 3：前端状态管理问题
React 的状态更新可能有问题，导致 UI 没有反映最新的数据。

**解决方案：** 检查 `loadData()` 函数是否正确更新了 state。

### 原因 4：使用了错误的 userId
前端可能在使用错误的 userId 进行请求。

**解决方案：** 在 Network 面板中检查实际请求的 URL。

## 快速验证

在浏览器控制台依次运行以下命令：

```javascript
// 1. 获取当前画像
fetch('http://192.168.31.100:43111/api/profiles/test20260115')
  .then(r => r.json())
  .then(d => console.log('1. Current profile:', d.basic_info));

// 2. 更新画像
fetch('http://192.168.31.100:43111/api/profiles/test20260115', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    basic_info: { age: 100, height: 200, weight: 150, body_fat: 20, training_age: 36 },
    preferences: { goal: '快速测试', duration: 10 },
    modifiedBy: 'console_test'
  })
})
  .then(r => r.json())
  .then(d => console.log('2. Update result:', d));

// 3. 验证更新（2秒后）
setTimeout(() => {
  fetch('http://192.168.31.100:43111/api/profiles/test20260115')
    .then(r => r.json())
    .then(d => console.log('3. After update:', d.basic_info));
}, 2000);
```

如果步骤 3 显示的 `basic_info` 包含你设置的数据（age: 100, height: 200 等），说明后端保存正常。

## 下一步

请按照上述步骤逐一测试，并将以下信息反馈给我：

1. 步骤 5 的控制台输出结果
2. Network 面板中 PUT 请求的详细信息（URL、Payload、Response）
3. 后端服务器终端的日志输出
4. 是否尝试了无痕模式，结果如何

根据这些信息，我可以进一步定位问题。
