import { createRoute, redirect, Outlet, useRouterState } from '@tanstack/react-router'
import { rootRoute } from '@/root-route'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuthStore } from '@/stores/auth'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/nodes': 'Nodes',
  '/containers': 'Containers',
  '/agents': 'Agents',
  '/audit': 'Audit Log',
  '/settings': 'Settings',
  '/diagnostics': 'Diagnostics',
  '/logs': 'Logs',
}

function getTitle(pathname: string): string {
  // Exact match first
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  // Pattern match for dynamic routes
  if (/^\/nodes\/[^/]+\/guests\/[^/]+/.test(pathname)) return 'Guest Detail'
  if (/^\/nodes\/[^/]+/.test(pathname)) return 'Node Detail'
  return 'ninja-ops'
}

function AuthLayout() {
  const state = useRouterState()
  const pathname = state.location.pathname
  const title = getTitle(pathname)
  return (
    <AppLayout title={title}>
      <Outlet />
    </AppLayout>
  )
}

export const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_layout',
  beforeLoad: ({ location }) => {
    const { token } = useAuthStore.getState()
    if (!token) {
      throw redirect({ to: '/login', search: { redirect: location.pathname } })
    }
  },
  component: AuthLayout,
})
