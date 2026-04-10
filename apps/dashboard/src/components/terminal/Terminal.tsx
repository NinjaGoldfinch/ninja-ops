import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ws } from '@/lib/ws'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  nodeId: string
  vmid: number
  sessionId: string
}

export function Terminal({ nodeId, vmid, sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      theme: {
        background: '#09090b',
        foreground: '#e4e4e7',
        cursor: '#a1a1aa',
      },
      fontFamily: '"Geist Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    // Open terminal session with initial dimensions
    ws.send({
      type: 'terminal_open',
      nodeId,
      vmid,
      sessionId,
      cols: term.cols,
      rows: term.rows,
    })

    // Send input to WS
    const disposeOnData = term.onData((data) => {
      ws.send({ type: 'terminal_input', sessionId, data })
    })

    // Receive output from WS
    const unsubOutput = ws.on('terminal_output', (msg) => {
      if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
        term.write(msg.data)
      }
    })

    const unsubClosed = ws.on('terminal_closed', (msg) => {
      if (msg.type === 'terminal_closed' && msg.sessionId === sessionId) {
        term.writeln('\r\n\x1b[33mConnection closed.\x1b[0m')
      }
    })

    // Resize observer
    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      ws.send({
        type: 'terminal_resize',
        sessionId,
        cols: term.cols,
        rows: term.rows,
      })
    })
    observer.observe(containerRef.current)

    return () => {
      disposeOnData.dispose()
      unsubOutput()
      unsubClosed()
      observer.disconnect()
      ws.send({ type: 'terminal_close', sessionId })
      term.dispose()
    }
  }, [nodeId, vmid, sessionId])

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-zinc-950 rounded-lg overflow-hidden"
      style={{ minHeight: 300 }}
    />
  )
}
