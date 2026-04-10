import { useState } from 'react'
import { Power } from 'lucide-react'
import { DropdownMenu, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown-menu'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usePowerAction } from '@/hooks/useGuests'
import { useToast } from '@/components/ui/toast'
import type { Guest, PowerAction } from '@ninja/types'

interface PowerActionMenuProps {
  guest: Guest
}

type ActionDef = {
  action: PowerAction
  label: string
  destructive?: boolean
  confirm?: boolean
}

const ACTIONS: ActionDef[] = [
  { action: 'start', label: 'Start' },
  { action: 'stop', label: 'Stop', destructive: true, confirm: true },
  { action: 'reboot', label: 'Reboot', confirm: true },
  { action: 'shutdown', label: 'Shutdown', destructive: true, confirm: true },
  { action: 'suspend', label: 'Suspend' },
  { action: 'resume', label: 'Resume' },
]

function isActionDisabled(action: PowerAction, status: Guest['status']): boolean {
  if (status === 'running') return action === 'start' || action === 'resume'
  if (status === 'stopped') return action === 'stop' || action === 'shutdown' || action === 'reboot'
  if (status === 'paused') return action === 'suspend'
  return false
}

export function PowerActionMenu({ guest }: PowerActionMenuProps) {
  const { mutate, isPending } = usePowerAction()
  const { toast } = useToast()
  const [pending, setPending] = useState<PowerAction | null>(null)

  function execute(action: PowerAction) {
    mutate(
      { nodeId: guest.nodeId, vmid: guest.vmid, action },
      {
        onSuccess: () => toast({ title: `${action} sent`, variant: 'success' }),
        onError: (err) =>
          toast({ title: 'Action failed', description: String(err), variant: 'error' }),
      },
    )
  }

  return (
    <>
      <DropdownMenu
        align="right"
        trigger={
          <Button variant="ghost" size="icon" disabled={isPending} aria-label="Power actions">
            <Power size={14} />
          </Button>
        }
      >
        {ACTIONS.filter((a) => {
          if (guest.type === 'qemu') return true
          return a.action !== 'suspend' && a.action !== 'resume'
        }).map((def, i) => {
          const disabled = isActionDisabled(def.action, guest.status)
          return (
            <div key={def.action}>
              {i === 2 && <DropdownSeparator />}
              <DropdownItem
                disabled={disabled}
                variant={def.destructive ? 'destructive' : 'default'}
                onClick={() => {
                  if (def.confirm) {
                    setPending(def.action)
                  } else {
                    execute(def.action)
                  }
                }}
              >
                {def.label}
              </DropdownItem>
            </div>
          )
        })}
      </DropdownMenu>

      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={`Confirm: ${pending}`}
        description={`Are you sure you want to ${pending} ${guest.name}?`}
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (pending) execute(pending)
              setPending(null)
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}
