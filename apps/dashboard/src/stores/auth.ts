import { create } from 'zustand'
import type { Role } from '@ninja/types'

interface AuthUser {
  id: string
  username: string
  role: Role
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  login: (token: string, user: AuthUser) => void
  logout: () => void
}

const SESSION_KEY = 'ninja_auth'

function loadFromSession(): { token: string; user: AuthUser } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as { token: string; user: AuthUser }
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set) => {
  const saved = loadFromSession()

  return {
    token: saved?.token ?? null,
    user: saved?.user ?? null,

    login(token, user) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }))
      set({ token, user })
    },

    logout() {
      sessionStorage.removeItem(SESSION_KEY)
      set({ token: null, user: null })
    },
  }
})
