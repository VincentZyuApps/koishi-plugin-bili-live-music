> 💡 推荐前往 [GitHub](https://github.com/VincentZyuApps/koishi-plugin-bili-live-music) 阅读 README，体验更好。

# 🎵 koishi-plugin-bili-live-music

[![npm](https://img.shields.io/npm/v/koishi-plugin-bili-live-music?style=flat-square&logo=npm)](https://www.npmjs.com/package/koishi-plugin-bili-live-music)
[![npm-download](https://img.shields.io/npm/dm/koishi-plugin-bili-live-music?style=flat-square&logo=npm)](https://npm-stat.com/charts.html?package=koishi-plugin-bili-live-music)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/VincentZyuApps/koishi-plugin-bili-live-music)
[![QQ群](https://img.shields.io/badge/QQ群-1085190201-12B7F5?style=flat-square&logo=qq&logoColor=white)](https://qm.qq.com/q/ZHj33L5cuC)

<h2>💬 交流反馈</h2>
<p>🐛 Bug 反馈 / 💡 建议 / 👨‍💻 插件交流，欢迎加群：<b>1085190201</b> 🎉</p>
<p>💡 在群里直接艾特 @VincentZyu，回复更及时~ ✨</p>

B站直播间点歌，支持弹幕、Bot 与 WebUI 队列管理，可通过 OBS 浏览器源或插件专属 VLC 进程播放音频。

## 功能

- 监听指定 B 站直播间的弹幕，识别 `点歌 歌名`。
- 通过落月 API 搜索网易云音乐、QQ 音乐或酷狗音乐。
- 维护点歌队列，提供用户冷却、单用户上限、队列上限和歌曲时长限制。
- 使用独立 Fastify 服务向 OBS 浏览器源提供播放页面和 WebSocket。
- 使用 Axios 统一发起音乐与 B 站身份 API 请求，请求超时为 15 秒且不自动重试。
- 提供 Browser 与 VLC 两种播放后端，默认保持 Browser，不改变升级后的现有行为。
- Browser 模式区分主播放器与展示端，确保同一时间只有一个页面播放音频和推进队列。
- VLC 模式由插件启动并管理专属隐藏进程，Overlay 继续显示歌曲、进度和队列。

## 落月 API

`apiBaseUrl` 默认使用落月官方 API：

```text
https://api.vkeys.cn
```

也可在 Koishi 控制台中替换为 VincentZyu 自建 API：

```text
http://xwl.vincentzyu233.cn:51217
```

| API | 网易云 | QQ 音乐 | 酷狗 |
| --- | --- | --- | --- |
| `https://api.vkeys.cn` | 支持 | 支持 | 当前不支持 |
| `http://xwl.vincentzyu233.cn:51217` | 支持 | 支持 | 支持 |

自建 API 如果不可用，可在 QQ 群 `1085190201` 联系 `@VincentZyu`。

> 自建 API 当前使用 HTTP。如果 Koishi 页面通过 HTTPS 对外提供，浏览器可能拦截 API 返回的 HTTP 音频链接，建议使用本地 HTTP OBS 浏览器源或为 API 配置 HTTPS 反向代理。

## 音乐后端

插件在 Koishi 配置中统一选择音乐后端，B 站弹幕、Bot 指令和 WebUI 使用同一份设置。

- `netease`：使用网易云搜索，可选 `api.injahow.cn`、`api.qijieya.cn`、`meting.jmstrand.cn` 或 `metingapi.nanorocky.top` 生成播放直链。
- `luoyue`：支持自定义 API URL，并可多选网易云、QQ 音乐和酷狗。WebUI 多平台搜索会并行请求并交替合并结果。

WebUI 默认返回最多 20 条候选结果。搜索阶段只获取元数据，点击加入队列时才解析播放 URL。`webuiSearchExpireMinutes` 默认是 `30`，表示搜索结果在内存中保留 30 分钟；设置为小于或等于 `0` 时，本次插件运行期间永不过期。插件重启或 HMR 热重载始终会清空搜索结果。

`verboseConsoleLog` 默认关闭。开启后，控制台会在普通操作摘要之外输出 WebUI 搜索标识、候选歌曲 ID、音乐源请求参数、响应摘要和耗时；带签名的完整播放直链不会写入日志。

## 使用

1. 在 Koishi 中启用 `w-node` 和本插件；队列管理 WebUI 还需要启用 `console`。
2. 填写 `roomId`；普通公开直播间可先留空 `cookie` 和 `uid`。
3. 按需选择 `enabledSources`；使用酷狗时需将 `apiBaseUrl` 切换到支持酷狗的 API。
4. 在 `playbackBackend` 中选择 Browser 或 VLC；VLC 模式需要填写可用的 `vlcExecutablePath`。
5. 保持默认 OBS 独立服务配置，或按需修改监听地址、端口、展示地址和访问令牌。
6. 在 OBS 中添加浏览器源，地址填写插件日志或 `bili-live-music.overlay` 指令返回的地址。
7. 默认地址为 `http://127.0.0.1:60716/bili-live-music/overlay?token=test12345&mode=player&layout=standard`。
8. 在直播间发送 `点歌 晴天`。

### 播放后端

`playbackBackend` 默认为 `browser`。Browser 模式由唯一的 `mode=player` 页面使用 `<audio>` 播放，适合让声音直接进入 OBS 混音器。VLC 模式在 Koishi 所在设备启动专属 VLC 进程，所有 Overlay 页面仅负责展示，但仍可通过交互按钮控制上一首、暂停和下一首。

| 通用播放配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `playbackVolume` | `100` | Browser 与 VLC 共用的初始音量，可配置 0–100%。 |
| `playbackLoadTimeout` | `25` | 单曲开始播放的等待上限，单位秒；超时后标记失败并继续下一首。 |

| VLC 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `vlcExecutablePath` | `vlc` | VLC 可执行文件；未加入 PATH 时填写完整的 `vlc.exe` 路径。 |
| `vlcRcPort` | `60717` | RC 控制端口，只绑定 `127.0.0.1`。 |
| `vlcStartupTimeout` | `10000` | VLC 启动及 RC 连接超时，单位毫秒。 |
| `vlcAudioDevice` | 空 | VLC 音频设备内部 ID；留空跟随系统默认设备。 |
| `vlcShowWindow` | `false` | 默认隐藏插件专属 VLC 窗口，排错时可显示。 |
| `vlcAutoRestart` | `true` | VLC 异常退出后自动重启。 |
| `vlcRestartLimit` | `1` | 单次异常后的自动重启次数。 |

正式支持 Windows x64 VLC `3.0.18–3.0.23`，VLC 3 的其他版本属于尽力支持，VLC 4 nightly 属于实验支持，VLC 2.x 不支持。本机 VLC 3.0.21 已通过真实 RC 播放测试。

WebUI 的播放后端区域提供统一的 0–100% 实时音量滑块；调整只影响当前插件运行，不会修改 `koishi.yml`，插件重启后重新使用 `playbackVolume`。VLC 模式还提供“检测 VLC”“查询音频设备”和“重启 VLC”。查询结果会显示设备内部 ID，将目标 ID 写入 `vlcAudioDevice` 并重载插件即可固定输出设备。

单首歌曲地址过期或 VLC 无法解码时，插件会跳过该曲并继续下一首。VLC 进程或 RC 整体故障时会自动重启一次；重启成功后当前歌曲从头播放，重启失败则保留当前歌曲和等待队列并停止调度，等待管理员修复后从 WebUI 重启。

### OBS 独立服务

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `obsServerHost` | `0.0.0.0` | Fastify 监听地址；接受所有网卡连接，但不能直接作为网页访问地址。 |
| `obsServerPort` | `60716` | OBS 页面与 WebSocket 的独立端口；端口被占用时插件启动失败。 |
| `obsPublicHost` | `127.0.0.1` | 仅用于生成展示地址；跨机器连接时填写局域网 IP、公网 IP 或域名。 |
| `obsAccessToken` | `test12345` | 页面与 WebSocket 访问令牌；默认值仅用于测试，正式使用时必须修改。 |

Browser 模式下，主播放器会实际播放音频，并向插件报告播放进度、结束或失败；展示端只显示当前歌曲和队列。VLC 模式下两种地址都不会在网页中播放音频，页面状态会显示“VLC 播放后端”。

歌曲已进入当前播放位但 Browser 或 VLC 尚未确认开始播放时，Console WebUI 与全部 Overlay 布局会在封面上显示加载动画。加载超过 `playbackLoadTimeout` 后，该歌曲会显示为“播放失败”，随后自动尝试队列中的下一首。

```text
# 主播放器，适合 OBS 浏览器源
http://127.0.0.1:60716/bili-live-music/overlay?token=test12345&mode=player&layout=standard

# 展示端，适合第二个 OBS 场景或普通浏览器监看
http://127.0.0.1:60716/bili-live-music/overlay?token=test12345&mode=display&layout=standard
```

`layout` 与播放角色相互独立，支持以下三种紧凑画布布局：

| layout | OBS 推荐尺寸 | 内容 |
| --- | --- | --- |
| `mini` | `520 × 104` | 封面、歌名、歌手和进度，适合角落。 |
| `standard` | `640 × 240` | 当前歌曲、点歌人、进度和后续 2 首。 |
| `sidebar` | `300 × 666.666666` | 大封面、完整歌曲信息和后续 5 首。 |

页面组件使用上表的固定尺寸，即使浏览器源画布更大也不会横向拉伸，而是在透明画布中居中显示。建议 OBS 浏览器源直接使用对应推荐尺寸，位置和整体缩放在 OBS 中调整。

页面中的设备状态组件会显示当前角色。展示端可点击“设为主播放器”接管播放，旧主播放器会停止音频并降级为展示端。没有主播放器时，新点歌曲目只进入等待队列；主播放器重连后，当前歌曲会从头播放。OBS 临时预览连接关闭时，服务端会优先把角色交还给仍在线的 `mode=player` 页面，不会让 `mode=display` 自动发声。

主播放器悬停时会显示上一首、播放/暂停和下一首按钮。在 OBS 中可通过“与浏览器源交互”操作。最近播放历史默认保留 25 首，可通过 `historyLimit` 修改；历史只保存在内存中，插件重启后清空。

最后一首歌曲结束且队列为空后，Overlay 与 Console WebUI 会继续保留该歌曲的封面、歌名、歌手和进度，并显示半透明结束遮罩。自然结束显示“已播放结束”，手动切歌显示“已跳过”，单曲加载或解码失败显示红色“播放失败”；自然结束进度固定为 100%，其余原因保留实际停止位置。最后歌曲会保留到下一首开始或插件重启，期间可以使用“上一首”从头重播。

插件会自动将 `LXGWWenKaiMono-Regular.ttf` 下载到 `ctx.baseDir/data/assets/bili-live-music/fonts`，依次尝试 Gitee 和 GitHub，并校验文件大小与 SHA-256。Overlay 与 Console WebUI 共用 Fastify 字体路由；下载失败、HTTPS 页面阻止 HTTP 字体或字体服务不可达时会回退到系统字体。

在 OBS 的“来源”面板点击 `+`，选择“浏览器”，并按以下方式设置：

- Browser 模式的 URL 填写 `mode=player` 主播放器地址；VLC 模式可使用任意展示地址。
- 宽度和高度直接使用布局表中的推荐尺寸，页面组件不会随浏览器源画布拉伸。
- Browser 模式建议启用“通过 OBS 控制音频”，让网页音乐进入 OBS 混音器；需要本机也听见时，在“高级音频属性”中将监听设为“监听并输出”。
- VLC 模式的声音从 Koishi 所在设备输出，OBS 中需要启用“桌面音频”或添加“应用程序音频采集”并选择插件启动的 VLC。
- 建议关闭“场景变为活动状态时刷新浏览器”和“场景不可见时关闭源”，否则切换场景会断开播放器并让当前歌曲从头播放。
- Browser 模式同一时间只保留一个 `mode=player` 页面。其他场景或浏览器监看请使用 `mode=display`，避免主播放器被后打开的页面接管。

Fastify 仅提供 HTTP。需要公网 HTTPS 时，请使用 Nginx、Caddy 等反向代理管理 TLS。

### B 站登录说明

监听普通公开直播间不需要登录 B 站。Cookie 留空时，插件会自动初始化匿名 `buvid3` 设备标识并使用 `uid=0`；`buvid3` 不是账号登录凭证。

只有受限直播间、需要完整弹幕用户名，或 B 站限制匿名访问时，才需要填写登录 Cookie。登录 Cookie 建议包含 `SESSDATA`、`DedeUserID` 和 `buvid3`，配置的 `uid` 必须与 `DedeUserID` 一致。

### 弹幕连接与自动重连

弹幕监听使用 `disabled`、`starting`、`connected`、`waiting`、`reconnecting` 和 `stopped` 六个状态。每次连接最多等待 10 秒完成认证；失败后按照 `1、2、4、8、16、32` 秒指数退避，达到 32 秒后继续每 32 秒无限重试。因此先启动 Koishi、稍后再开启直播时，不需要重载插件。

连接成功后失败次数归零，下一次断线重新从 1 秒开始。插件卸载或 HMR 时会关闭监听器并清理连接超时与重试计时器，旧连接的迟到回调不会影响新实例。

## Bot 点歌

在 `botRequestContexts` 中勾选群聊或私聊后，可使用：

```text
bili-live-music.request 晴天
```

该指令与 B 站弹幕点歌共用搜索、用户冷却、单用户上限和播放队列。全部取消勾选时不会注册该指令。

## WebUI 队列管理

Koishi 控制台会新增「直播点歌」页面，支持：

- 查看当前播放、点歌人和点歌入口。
- 搜索候选歌曲并以 `WebUI 管理员` 身份加入队列。
- 置顶、上移、下移或删除等待歌曲。
- 跳过当前歌曲或清空等待队列。
- 查看 Browser/VLC 运行状态，并检测 VLC、查询音频设备或重启专属 VLC 进程。
- 查看 B 站弹幕连接状态、失败次数、重试倒计时并手动重连。

Console 始终注册「直播点歌」与「弹幕状态机」两个页面，页面可以相互跳转。`enableMusicManagementPage` 默认开启，控制直播点歌管理内容；`enableDanmuStateMachinePage` 默认关闭，控制六节点状态图和最近 25 条内存转换记录。关闭页面内容后路由仍然保留，并显示需要开启的配置项。

WebUI 手动加歌会绕过用户冷却和单用户上限，但仍遵守单曲时长和总队列上限。队列仅保存在内存中，重启插件后会清空。

`cooldown` 的单位是秒，默认值为 `25`，设置为 `0` 可关闭 CD。B 站弹幕和 Bot 点歌会受到限制，WebUI 管理员手动加歌会绕过限制。B 站匿名监听返回 `uid=0` 时，插件改用弹幕用户名区分观众，避免所有匿名观众共享同一个冷却计时器。

## 命令

```text
bili-live-music.status   # 查看当前歌曲和队列
bili-live-music.skip     # 跳过当前歌曲，需要 3 级权限
bili-live-music.clear    # 清空等待队列，需要 3 级权限
bili-live-music.overlay  # 查看含访问令牌的 OBS 地址，需要 3 级权限
bili-live-music.danmu.status     # 查看弹幕监听状态，需要 3 级权限
bili-live-music.danmu.reconnect  # 断开并重新连接弹幕监听，需要 3 级权限
```

手动重连最多等待 10 秒。认证成功时返回 `connected` 和实际耗时；明确失败或超时时返回 `waiting`、连续失败次数和下一次自动重试时间。
