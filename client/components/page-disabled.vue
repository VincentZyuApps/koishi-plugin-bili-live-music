<template>
  <section class="disabled-page">
    <div class="disabled-icon" aria-hidden="true">×</div>
    <h2>{{ title }}</h2>
    <p>请在 bili-live-music 插件配置中开启 <code>{{ configKey }}</code></p>
    <a :href="targetPath">{{ targetLabel }}</a>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  configKey: string
  targetLabel: string
  targetPath: string
}>()
</script>

<style scoped>
.disabled-page {
  display: grid;
  min-height: 420px;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 32px;
  color: var(--fg1, #20242a);
  text-align: center;
  background: var(--k-main-bg, #f5f6f8);
  letter-spacing: 0;
}
.disabled-icon { display: grid; width: 48px; height: 48px; place-items: center; border: 2px solid #c43b46; border-radius: 50%; color: #c43b46; font-size: 28px; }
h2, p { margin: 0; }
h2 { font-size: 20px; }
p { color: var(--fg2, #68717d); font-size: 13px; }
code { color: #c92f6b; }
a { display: inline-flex; height: 36px; margin-top: 8px; padding: 0 14px; align-items: center; border: 1px solid var(--k-color-divider, #dfe3e8); border-radius: 6px; color: var(--fg1, #20242a); background: var(--k-card-bg, #fff); text-decoration: none; }
a:hover { border-color: #e84d87; color: #c92f6b; }
</style>
