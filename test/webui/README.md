# WebUI 与 OBS Overlay 浏览器测试

这里的两个脚本分别测试两套独立页面：

- `test_koishi_webui.py`：测试 Koishi Console 中的 `/bili-live-music` 管理页面，使用 Koishi 自己的登录会话。
- `test_obs_overlay.py`：测试 Fastify 提供的 OBS Overlay 页面，使用 `obsAccessToken` 鉴权，不依赖 Koishi Console 登录。

脚本不会读取、导出或打印浏览器 Cookie。浏览器路径、目标 URL、用户数据目录和 OBS Token 都必须通过命令行显式传入。

## 安装依赖

在插件的 `test` 目录中创建虚拟环境后执行：

```powershell
\.venv\Scripts\Activate.ps1
uv pip install -r .\webui\requirements.txt
```

脚本直接使用通过 `--browser-path` 指定的 Edge，因此不需要执行 `playwright install` 下载 Chromium。

## 推荐：使用专用 Edge 档案测试 Koishi Console

不要直接复用日常 Edge 的默认档案。正在运行的 Edge 会锁定该档案，自动化测试也会写入浏览器状态。

第一次测试时使用 `--interactive-login`。脚本打开 Koishi 后，在浏览器中完成登录，再回到终端按回车；登录状态会保存在显式指定的专用目录中。

```powershell
python .\webui\test_koishi_webui.py `
  --browser-path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --user-data-dir ".\webui\.edge-profile" `
  --login-url "http://localhost:15140/" `
  --target-url "http://localhost:15140/bili-live-music" `
  --screenshot ".\webui\artifacts\koishi-webui.png" `
  --search-keyword "晴天" `
  --add-result-index 1 `
  --interactive-login `
  --pause
```

以后复用已经登录的专用档案时，去掉 `--interactive-login`：

```powershell
python .\webui\test_koishi_webui.py `
  --browser-path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --user-data-dir ".\webui\.edge-profile" `
  --login-url "http://localhost:15140/" `
  --target-url "http://localhost:15140/bili-live-music" `
  --screenshot ".\webui\artifacts\koishi-webui.png"
```

确实需要复用现有 Edge 档案时，可以额外传入 `--profile-directory "Default"`，但必须先关闭所有 Edge 进程。更推荐使用上面的专用档案方案。

## 测试 OBS Overlay

OBS Overlay 与 Koishi Console 是两套鉴权。下面命令中的 Token 只是 README 示例，运行时应替换为当前插件配置中的 `obsAccessToken`。

先以展示端打开，不播放音频，也不会抢占正在使用的 OBS 主播放器：

```powershell
python .\webui\test_obs_overlay.py `
  --browser-path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --overlay-url "http://127.0.0.1:60716/bili-live-music/overlay" `
  --token "test12345" `
  --mode display `
  --layout mini `
  --screenshot ".\webui\artifacts\obs-display.png" `
  --pause
```

验证展示端主动接管主播放器：

```powershell
python .\webui\test_obs_overlay.py `
  --browser-path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --overlay-url "http://127.0.0.1:60716/bili-live-music/overlay" `
  --token "test12345" `
  --mode display `
  --layout standard `
  --claim-player `
  --screenshot ".\webui\artifacts\obs-player.png"
```

`--claim-player` 会让当前页面接管主播放器并停止原主播放器，直播过程中请谨慎使用。

## 可选参数

- `--headless`：无界面运行。
- `--pause`：测试完成后等待回车再关闭浏览器。
- `--timeout-ms`：调整页面加载与元素等待超时。
- `--layout`：选择 `mini`、`standard` 或 `sidebar`，脚本会在 `1000 × 900` 的大画布中断言组件的固定尺寸，可以发现意外拉伸。
- `--backend`：选择当前配置的 `browser` 或 `vlc`；VLC 模式会断言页面显示“VLC 播放后端”且网页音频保持暂停。
- `--mock-finished`：注入 `ended`、`skipped` 或 `error` 结束态并验证遮罩，不会修改真实播放队列。
- `--mock-loading`：注入歌曲加载态并验证封面加载动画，不会修改真实播放队列。
- `--profile-directory`：指定现有 Edge 用户数据目录中的档案名称，仅 Koishi Console 脚本支持。
- `--search-keyword`：执行一次真实音乐搜索，并要求至少显示一条结果。
- `--require-loaded-covers`：与搜索一起使用，要求所有可见搜索结果封面的 `naturalWidth` 大于 0。
- `--add-result-index`：将指定的搜索结果加入队列，序号从 `1` 开始，必须与 `--search-keyword` 一起使用。
- `--test-volume`：临时调整 0–100% 播放音量，刷新验证运行态仍保留后恢复原值。
