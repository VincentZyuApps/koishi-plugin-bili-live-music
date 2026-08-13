import { Context, icons } from '@koishijs/client'
import QueuePage from './page.vue'
import DanmuStateMachinePage from './danmu-state-machine.vue'
import LiveMusicIcon from './icons/live-music.vue'
import DanmuStateMachineIcon from './icons/danmu-state-machine.vue'

export default (ctx: Context) => {
  icons.register('activity:bili-live-music', LiveMusicIcon)
  icons.register('activity:bili-live-music-state-machine', DanmuStateMachineIcon)

  ctx.page({
    id: 'bili-live-music',
    name: '直播点歌',
    path: '/bili-live-music',
    component: QueuePage,
    icon: 'activity:bili-live-music',
    order: 420,
  })
  ctx.page({
    id: 'bili-live-music-danmu-state-machine',
    name: '弹幕状态机',
    path: '/bili-live-music/danmu-state-machine',
    component: DanmuStateMachinePage,
    icon: 'activity:bili-live-music-state-machine',
    order: 421,
  })
}
