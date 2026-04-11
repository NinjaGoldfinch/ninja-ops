// journald PRIORITY is syslog severity:
//   0=emerg, 1=alert, 2=crit, 3=err, 4=warn, 5=notice, 6=info, 7=debug
export function priorityToLevel(p: number): 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' {
  if (p <= 2) return 'fatal'
  if (p === 3) return 'error'
  if (p === 4) return 'warn'
  if (p === 5 || p === 6) return 'info'
  return 'debug'
}
