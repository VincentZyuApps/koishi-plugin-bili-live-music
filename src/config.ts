import { Schema } from 'koishi'
import { getDefaultOverlayTemplateDisplayPath } from './assets'
import { getDefaultFontDisplayPath } from './font'
import {
  KUGOU_QUALITY_LABELS,
  NETEASE_QUALITY_LABELS,
  TENCENT_QUALITY_LABELS,
  type BotRequestContext,
  type KugouQuality,
  type MusicBackend,
  type MusicSource,
  type NeteaseDirectApi,
  type NeteaseQuality,
  type TencentQuality,
} from './music/types'

export interface Config {
  // ===== 📡 B 站监听配置 =====
  enabled: boolean // 🚦 是否启动 B 站直播间弹幕监听
  roomId: string // 🏠 B 站直播间号
  cookie: string // 🍪 B 站 Cookie，受限房间建议填写
  uid: string // 🆔 B 站登录账号 UID，可选
  listenerVersion: string // 📦 blive-message-listener 版本，由 w-node 锁定加载

  // ===== 🎵 点歌与音乐 API =====
  commandPrefix: string // 💬 弹幕点歌前缀
  botRequestContexts: BotRequestContext[] // 🤖 Bot 点歌指令可用场景
  musicBackend: MusicBackend // 🌐 统一音乐后端
  neteaseDirectApi: NeteaseDirectApi // ☁️ 网易云直链 API
  apiBaseUrl: string // 🔗 落月 API 基础地址
  enabledSources: MusicSource[] // 🎧 启用的音乐源
  searchLimit: number // 🔍 每个平台搜索数量
  webuiSearchLimit: number // 🖥️ WebUI 搜索目标数量
  neteaseQuality: NeteaseQuality // ☁️ 网易云音质参数
  tencentQuality: TencentQuality // 🐧 QQ 音乐音质参数
  kugouQuality: KugouQuality // 🐶 酷狗音质参数

  // ===== 📋 队列限制 =====
  maxQueueSize: number // 📚 最大队列长度
  perUserLimit: number // 👤 单用户最多排队歌曲数
  cooldown: number // ⏳ 单用户点歌冷却时间
  maxDuration: number // ⏱️ 单首歌曲最长时长
  historyLimit: number // 🕘 最近播放历史数量

  // ===== 🖥️ OBS 独立播放服务 =====
  obsServerHost: string // 🧭 Fastify 监听地址
  obsServerPort: number // 🔌 Fastify 监听端口
  obsPublicHost: string // 🌍 用于生成 OBS 访问地址
  obsAccessToken: string // 🔑 Overlay 与 WebSocket 访问令牌
  overlayPath: string // 🌐 OBS 浏览器源页面路径
  wsPath: string // 🔌 OBS 浏览器源 WebSocket 路径
  overlayTemplatePath: string // 📄 OBS 页面模板路径，默认展示 cwd/data/assets，运行时使用 ctx.baseDir/data/assets
  fontPath: string // 🔤 霞鹜文楷字体路径
  overlayCommandConsoleOnly: boolean // 🖥️ OBS 地址指令是否仅输出到控制台

  // ===== 🐛 调试设置 =====
  verboseConsoleLog: boolean // 🐛 是否在控制台输出调试信息
}

export function normalizeConfig(input: Partial<Config>): Config {
  const config = input as Config
  config.enabled ??= true
  config.roomId ??= ''
  config.cookie ??= ''
  config.uid ??= ''
  config.listenerVersion ??= '0.5.4'

  config.commandPrefix ??= '点歌'
  config.botRequestContexts = Array.isArray(config.botRequestContexts)
    ? config.botRequestContexts.filter(value => value === 'group' || value === 'private')
    : ['group']
  if (config.musicBackend !== 'netease' && config.musicBackend !== 'luoyue') config.musicBackend = 'luoyue'
  config.neteaseDirectApi ??= 'api.qijieya.cn'
  config.apiBaseUrl ??= 'https://api.vkeys.cn'
  config.enabledSources = Array.isArray(config.enabledSources)
    ? config.enabledSources.filter(value => value === 'netease' || value === 'tencent' || value === 'kugou')
    : ['netease', 'tencent']
  config.searchLimit ??= 3
  config.webuiSearchLimit ??= 20
  config.neteaseQuality ??= 1
  config.tencentQuality ??= 10
  config.kugouQuality ??= '320'

  config.maxQueueSize ??= 30
  config.perUserLimit ??= 3
  config.cooldown ??= 30_000
  config.maxDuration ??= 10 * 60 * 1000
  config.historyLimit ??= 25

  config.obsServerHost ??= '0.0.0.0'
  config.obsServerPort ??= 60716
  config.obsPublicHost ??= '127.0.0.1'
  config.obsAccessToken ??= 'test12345'
  config.overlayPath ??= '/bili-live-music/overlay'
  config.wsPath ??= '/bili-live-music/ws'
  config.overlayTemplatePath ??= getDefaultOverlayTemplateDisplayPath()
  config.fontPath ??= getDefaultFontDisplayPath()
  config.overlayCommandConsoleOnly ??= true

  config.verboseConsoleLog ??= false
  return config
}

export const Config = Schema.intersect([
  // ===== 📡 B 站监听配置 =====
  Schema.object({
    enabled: Schema.boolean().default(true).description('🚦 是否启动 B 站直播间弹幕监听'),
    roomId: Schema.string()
      .description('🏠 B 站直播间号<br><i>直播间 URL 末尾的数字就是 roomId，例如 <code>https://live.bilibili.com/1854258163</code> 的 roomId 是 <code>1854258163</code></i>')
      .default(''),
    cookie: Schema.string()
      .role('textarea', { rows: [5, 8] })
      .description('🍪 B 站 Cookie，可选<br><i>普通公开直播间可留空，插件会自动初始化匿名 buvid3；受限房间或需要完整用户名时建议填写包含 SESSDATA、DedeUserID 和 buvid3 的完整 Cookie</i>')
      .default(''),
    uid: Schema.string()
      .description('🆔 B 站登录账号 UID，可选<br><i>仅在填写登录 Cookie 时生效；匿名连接固定使用 uid=0。个人主页 URL 末尾的数字就是 UID，例如 <code>https://space.bilibili.com/227050296</code> 的 UID 是 <code>227050296</code></i>')
      .default(''),
    listenerVersion: Schema.string().description('📦 通过 w-node 加载的 blive-message-listener 版本').default('0.5.4'),
  }).description('📡 B 站监听配置'),

  // ===== 🎵 点歌与音乐 API =====
  Schema.object({
    commandPrefix: Schema.string().description('💬 弹幕点歌前缀').default('点歌'),
    botRequestContexts: Schema.array(Schema.union([
      Schema.const('group').description('👥 群聊'),
      Schema.const('private').description('💬 私聊'),
    ])).role('checkbox').default(['group']).description('🤖 Bot 点歌指令 <code>bili-live-music.request</code> 的可用场景<br><i>全部取消勾选时不注册该指令</i>'),
    musicBackend: Schema.union([
      Schema.const('netease').description('☁️ 网易云直链 API'),
      Schema.const('luoyue').description('🌙 落月 API'),
    ]).role('radio').default('luoyue').description('🌐 统一音乐后端，同时作用于 B 站弹幕、Bot 指令和 WebUI'),
    searchLimit: Schema.natural().min(1).max(10).default(3).description('🔍 弹幕与 Bot 自动点歌时的单平台候选数量'),
    webuiSearchLimit: Schema.natural().min(1).max(50).default(20).description('🖥️ WebUI 搜索结果的目标总数'),
  }).description('🎵 点歌入口与音乐后端'),
  Schema.object({
    neteaseDirectApi: Schema.union([
      Schema.const('api.injahow.cn').description('⚡ api.injahow.cn（稳定，VIP 歌曲可能只有试听片段）'),
      Schema.const('api.qijieya.cn').description('🎶 api.qijieya.cn（完整歌曲，稳定性未知）'),
      Schema.const('meting.jmstrand.cn').description('🎵 meting.jmstrand.cn（完整歌曲，稳定性未知）'),
      Schema.const('metingapi.nanorocky.top').description('🎧 metingapi.nanorocky.top（无损链接，文件较大）'),
    ]).default('api.qijieya.cn').description('☁️ 网易云音乐直链后端'),
  }).description('☁️ 网易云 API 设置'),
  Schema.object({
    apiBaseUrl: Schema.string()
      .role('link')
      .description([
        '🔗 落月 API 的基础 URL，可替换为自建或镜像地址',
        '<br>🧩 官方 API：<code>https://api.vkeys.cn</code>',
        '<br>🌐 VincentZyu 自建 API：<code>http://xwl.vincentzyu233.cn:51217</code>',
        '<br><b>⚠️ 官方 API 目前不支持酷狗，VincentZyu 自建 API 支持网易云、QQ 音乐和酷狗</b>',
        '<br><i>💬 自建 API 如果不可用，可在 QQ 群 1085190201 联系 @VincentZyu</i>',
      ].join(''))
      .default('https://api.vkeys.cn'),
    enabledSources: Schema.array(Schema.union([
      Schema.const('netease').description('☁️ 网易云音乐'),
      Schema.const('tencent').description('🐧 QQ 音乐'),
      Schema.const('kugou').description('🐶 酷狗音乐'),
    ])).role('checkbox').default(['netease', 'tencent']).description('🎧 启用的音乐源，WebUI 多平台搜索时会并行请求并交替合并<br><i>官方 vkeys 当前不支持酷狗，使用 VincentZyu 自建 API 时可启用</i>'),
    neteaseQuality: Schema.union(
      Object.entries(NETEASE_QUALITY_LABELS).map(([value, label]) => Schema.const(Number(value) as NeteaseQuality).description(`☁️ ${label}`)),
    ).role('radio').default(1).description('☁️ 网易云音乐最大音质'),
    tencentQuality: Schema.union(
      Object.entries(TENCENT_QUALITY_LABELS).map(([value, label]) => Schema.const(Number(value) as TencentQuality).description(`🐧 ${label}`)),
    ).role('radio').default(10).description('🐧 QQ 音乐最大音质'),
    kugouQuality: Schema.union(
      Object.entries(KUGOU_QUALITY_LABELS).map(([value, label]) => Schema.const(value as KugouQuality).description(`🐶 ${label}`)),
    ).role('radio').default('320').description('🐶 酷狗音乐最大音质'),
  }).description('🌙 落月 API 设置'),

  // ===== 📋 队列限制 =====
  Schema.object({
    maxQueueSize: Schema.natural().default(30).description('📚 最大队列长度'),
    perUserLimit: Schema.natural().default(3).description('👤 单用户最多排队歌曲数'),
    cooldown: Schema.natural().role('time').default(30_000).description('⏳ 单用户点歌冷却时间'),
    maxDuration: Schema.natural().role('time').default(10 * 60 * 1000).description('⏱️ 单首歌曲最长时长'),
    historyLimit: Schema.natural().min(1).max(100).default(25).description('🕘 最近播放历史数量<br><i>用于“上一首”控制，历史仅保存在内存中，插件重启后清空</i>'),
  }).description('📋 队列限制'),

  // ===== 🖥️ OBS 独立播放服务 =====
  Schema.object({
    obsServerHost: Schema.string()
      .default('0.0.0.0')
      .description('🧭 Fastify 监听地址<br><i><code>0.0.0.0</code> 表示接受本机所有网卡的连接，它不是可直接访问的网页地址</i>'),
    obsServerPort: Schema.natural()
      .min(1)
      .max(65535)
      .default(60716)
      .description('🔌 OBS 独立 HTTP 与 WebSocket 服务端口<br><i>端口被占用时插件会启动失败并输出明确错误</i>'),
    obsPublicHost: Schema.string()
      .default('127.0.0.1')
      .description('🌍 用于生成并展示 OBS 访问地址，不影响服务器监听<br><i>OBS 与 Koishi 不在同一台机器时，请填写运行 Koishi 设备可被访问的局域网 IP、公网 IP 或域名</i>'),
    obsAccessToken: Schema.string()
      .role('secret')
      .default('test12345')
      .description('🔑 Overlay 页面与播放 WebSocket 的访问令牌<br><b>⚠️ 默认令牌仅便于测试，正式使用时请务必修改</b>'),
    overlayPath: Schema.string().default('/bili-live-music/overlay').description('🌐 OBS 浏览器源页面路径'),
    wsPath: Schema.string().default('/bili-live-music/ws').description('🔌 OBS 浏览器源 WebSocket 路径'),
    overlayTemplatePath: Schema.string()
      .role('textarea', { rows: [2, 5] })
      .default(getDefaultOverlayTemplateDisplayPath())
      .description('📄 OBS 页面模板路径<br><i>默认展示 cwd/data/assets/bili-live-music/template/overlay.html；运行时自动使用 ctx.baseDir/data/assets/bili-live-music/template/overlay.html</i>'),
    fontPath: Schema.string()
      .role('textarea', { rows: [2, 4] })
      .default(getDefaultFontDisplayPath())
      .description('🔤 霞鹜文楷字体路径<br><i>默认展示 cwd/data/assets/bili-live-music/fonts，运行时自动映射到 ctx.baseDir；文件不存在或校验失败时会依次从 Gitee、GitHub 下载</i>'),
    overlayCommandConsoleOnly: Schema.boolean()
      .default(true)
      .description('🖥️ <code>bili-live-music.overlay</code> 是否仅在 Koishi Console 输出 OBS 地址<br><i>开启：完整地址仅输出到 Console，并向当前 Session 发送查看提示；关闭：完整地址同时输出到 Console 和 Session</i>'),
  }).description('🖥️ OBS 独立播放服务'),

  // ===== 🐛 调试设置 =====
  Schema.object({
    verboseConsoleLog: Schema.boolean()
      .default(false)
      .description('🐛 是否在控制台输出详细调试日志<br><i>开启后会记录 WebUI 操作、音乐候选标识、API 请求参数与响应摘要，但不会输出完整播放直链</i>'),
  }).description('🐛 调试设置 🔧'),
]) as Schema<Config>
