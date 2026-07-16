import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'

const electronOnlyPaths = ['/downloads']

const router = createRouter({
  history: window.electronAPI ? createWebHashHistory() : createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/discover',
    },
    {
      path: '/discover',
      name: 'Discover',
      component: () => import('@/views/Discover.vue'),
    },
    {
      path: '/favorites',
      name: 'Favorites',
      component: () => import('@/views/Favorites.vue'),
    },
    {
      path: '/recent',
      name: 'RecentPlay',
      component: () => import('@/views/RecentPlay.vue'),
    },
    {
      path: '/playlist/:id',
      name: 'Playlist',
      component: () => import('@/views/PlaylistDetail.vue'),
    },
    {
      path: '/search/:keyword',
      name: 'Search',
      component: () => import('@/views/Search.vue'),
    },
    {
      path: '/artist/:id',
      name: 'Artist',
      component: () => import('@/views/Artist.vue'),
    },
    {
      path: '/album/:id',
      name: 'Album',
      component: () => import('@/views/Album.vue'),
    },
    {
      path: '/login',
      alias: '/debug-login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
    },
    {
      path: '/downloads',
      name: 'Downloads',
      component: () => import('@/views/Downloads.vue'),
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('@/views/Settings.vue'),
    },
  ],
})

router.beforeEach((to) => {
  const isElectron = !!window.electronAPI
  if (!isElectron && electronOnlyPaths.includes(to.path)) {
    return '/discover'
  }
})

export default router
