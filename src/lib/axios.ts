import axios from 'axios'
import { getApiBase, getAuthCookie } from '@/lib/authSession'

const api = axios.create({
  baseURL: getApiBase(),
  timeout: 60000,
})

api.interceptors.request.use((config) => {
  config.baseURL = getApiBase()

  // Browsers cannot set Cookie directly, so the same-origin Vite/Nginx proxy
  // converts this internal header. Electron injects from its main-process session.
  if (!window.electronAPI) {
    const cookie = getAuthCookie()
    if (cookie) config.headers['X-Umon-Cookie'] = cookie
  }
  return config
})

api.interceptors.response.use(
  (res) => res.data,
  (err) => Promise.reject(err),
)

export default api
