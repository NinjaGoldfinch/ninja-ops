import { createRootRoute, Outlet } from '@tanstack/react-router'

// Root route: no auth, no layout — just passes through.
// Auth guard lives on the layoutRoute (which wraps all authenticated pages).
export const rootRoute = createRootRoute({
  component: Outlet,
})
