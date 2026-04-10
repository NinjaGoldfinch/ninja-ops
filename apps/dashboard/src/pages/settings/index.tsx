import { createRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { layoutRoute } from '@/layout-route'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { Sun, Moon, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'

export const settingsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/settings',
  component: SettingsPage,
})

function SettingsPage() {
  const { theme, setTheme } = useUiStore()
  const { user } = useAuthStore()
  const { toast } = useToast()

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [changing, setChanging] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    setPwError(null)

    if (newPw.length < 12) {
      setPwError('New password must be at least 12 characters')
      return
    }

    setChanging(true)
    try {
      await api.put('/api/auth/password', { currentPassword: currentPw, newPassword: newPw })
      toast({ title: 'Password changed', variant: 'success' })
      setCurrentPw('')
      setNewPw('')
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setChanging(false)
    }
  }

  const themeOptions = [
    { value: 'light' as const, label: 'Light', icon: <Sun size={16} /> },
    { value: 'dark' as const, label: 'Dark', icon: <Moon size={16} /> },
    { value: 'system' as const, label: 'System', icon: <Monitor size={16} /> },
  ]

  return (
    <div className="max-w-xl space-y-6">
      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors',
                  theme === opt.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800',
                )}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            Signed in as <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{user?.username}</span>
            <span className="ml-2 capitalize text-xs">({user?.role})</span>
          </div>

          <form onSubmit={(e) => void handlePasswordChange(e)} className="space-y-4">
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Change Password
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="currentPw">Current password</Label>
              <Input
                id="currentPw"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPw">New password</Label>
              <Input
                id="newPw"
                type="password"
                value={newPw}
                onChange={(e) => { setNewPw(e.target.value); setPwError(null) }}
                autoComplete="new-password"
                minLength={12}
                required
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">Minimum 12 characters</p>
            </div>

            {pwError && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md px-3 py-2">
                {pwError}
              </p>
            )}

            <Button type="submit" disabled={changing} size="sm">
              {changing ? 'Changing…' : 'Change password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
