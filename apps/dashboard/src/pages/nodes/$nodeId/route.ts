import { createRoute, Outlet } from '@tanstack/react-router'
import { layoutRoute } from '@/layout-route'

export const nodeIdRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/nodes/$nodeId',
  component: Outlet,
})
