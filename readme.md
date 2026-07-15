# koishi-plugin-bili-live-music

[![npm](https://img.shields.io/npm/v/koishi-plugin-bili-live-music?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-bili-live-music)

B站直播间点歌，支持弹幕、Bot 与 WebUI 队列管理，通过 OBS 浏览器源播放音频。

## 功能

- 监听指定 B 站直播间的弹幕，识别 `点歌 歌名`。
- 通过落月 API 搜索网易云音乐、QQ 音乐或酷狗音乐。
- 维护点歌队列，提供用户冷却、单用户上限、队列上限和歌曲时长限制。
- 使用独立 Fastify 服务向 OBS 浏览器源提供播放页面和 WebSocket。
- 使用 Axios 统一发起音乐与 B 站身份 API 请求，请求超时为 15 秒且不自动重试。
- 区分主播放器与展示端，确保同一时间只有一个页面播放音频和推进队列。

> 当前版本只实现了 OBS 浏览器源播放，暂未实现 VLC 和 mpv 控制。

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

WebUI 默认返回最多 20 条候选结果。搜索阶段只获取元数据，点击加入队列时才解析播放 URL。

## 使用

1. 在 Koishi 中启用 `w-node` 和本插件；队列管理 WebUI 还需要启用 `console`。
2. 填写 `roomId`；普通公开直播间可先留空 `cookie` 和 `uid`。
3. 按需选择 `enabledSources`；使用酷狗时需将 `apiBaseUrl` 切换到支持酷狗的 API。
4. 保持默认 OBS 独立服务配置，或按需修改监听地址、端口、展示地址和访问令牌。
5. 在 OBS 中添加浏览器源，地址填写插件日志或 `bili-live-music.overlay` 指令返回的主播放器地址。
6. 默认地址为 `http://127.0.0.1:60716/bili-live-music/overlay?token=test12345&mode=player`。
7. 在直播间发送 `点歌 晴天`。

### OBS 独立服务

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `obsServerHost` | `0.0.0.0` | Fastify 监听地址；接受所有网卡连接，但不能直接作为网页访问地址。 |
| `obsServerPort` | `60716` | OBS 页面与 WebSocket 的独立端口；端口被占用时插件启动失败。 |
| `obsPublicHost` | `127.0.0.1` | 仅用于生成展示地址；跨机器连接时填写局域网 IP、公网 IP 或域名。 |
| `obsAccessToken` | `test12345` | 页面与 WebSocket 访问令牌；默认值仅用于测试，正式使用时必须修改。 |

主播放器会实际播放音频，并向插件报告播放结束或失败。展示端只显示当前歌曲和队列，不播放音频，也不能推进队列。

```text
# 主播放器，适合 OBS 浏览器源
http://127.0.0.1:60716/bili-live-music/overlay?token=test12345&mode=player

# 展示端，适合第二个 OBS 场景或普通浏览器监看
http://127.0.0.1:60716/bili-live-music/overlay?token=test12345&mode=display
```

页面中的设备状态组件会显示当前角色。展示端可点击“设为主播放器”接管播放，旧主播放器会停止音频并降级为展示端。没有主播放器时，新点歌曲目只进入等待队列；主播放器重连后，当前歌曲会从头播放。

Fastify 仅提供 HTTP。需要公网 HTTPS 时，请使用 Nginx、Caddy 等反向代理管理 TLS。

### B 站登录说明

监听普通公开直播间不需要登录 B 站。Cookie 留空时，插件会自动初始化匿名 `buvid3` 设备标识并使用 `uid=0`；`buvid3` 不是账号登录凭证。

只有受限直播间、需要完整弹幕用户名，或 B 站限制匿名访问时，才需要填写登录 Cookie。登录 Cookie 建议包含 `SESSDATA`、`DedeUserID` 和 `buvid3`，配置的 `uid` 必须与 `DedeUserID` 一致。

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

WebUI 手动加歌会绕过用户冷却和单用户上限，但仍遵守单曲时长和总队列上限。队列仅保存在内存中，重启插件后会清空。

## 命令

```text
bili-live-music.status   # 查看当前歌曲和队列
bili-live-music.skip     # 跳过当前歌曲，需要 3 级权限
bili-live-music.clear    # 清空等待队列，需要 3 级权限
bili-live-music.overlay  # 查看含访问令牌的 OBS 地址，需要 3 级权限
```
