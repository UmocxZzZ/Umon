import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './assets/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue Error]', err)
  console.error('[Vue Error Info]', info)
  console.error('[Vue Component]', instance?.$?.type?.name || instance?.$?.type?.__name || 'unknown')
  console.error('[Vue Error Stack]', (err as Error).stack)
}

router.onError((err) => {
  console.error('[Router Error]', err)
})

app.mount('#app')
