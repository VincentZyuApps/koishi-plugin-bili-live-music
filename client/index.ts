import { Context } from '@koishijs/client'
import QueuePage from './page.vue'

export default (ctx: Context) => {
  ctx.page({
    name: '直播点歌',
    path: '/bili-live-music',
    component: QueuePage,
    icon: 'music',
    order: 420,
  })
}
