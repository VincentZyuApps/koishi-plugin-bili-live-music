import type { Context } from 'koishi'
import type { Config } from '../config'
import { OverlayHub } from '../overlay/hub'
import { BrowserPlaybackBackend } from './browser/backend'
import { PlaybackManager } from './manager'
import { VlcPlaybackBackend } from './vlc/backend'

export function createPlaybackManager(ctx: Context, config: Config, hub: OverlayHub): PlaybackManager {
  const backend = config.playbackBackend === 'vlc'
    ? new VlcPlaybackBackend(ctx, config)
    : new BrowserPlaybackBackend(hub, config)
  return new PlaybackManager(backend)
}
