import { useRef, useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, ArrowDown } from 'lucide-react'
import { formatTimestamp } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { DeployLogLine } from '@ninja/types'

interface DeployLogViewerProps {
  lines: DeployLogLine[]
  isStreaming: boolean
}

export function DeployLogViewer({ lines, isStreaming }: DeployLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      setUserScrolled(false)
    }
  }, [])

  // Auto-scroll on new lines when streaming and user hasn't scrolled up
  useEffect(() => {
    if (isStreaming && !userScrolled) {
      scrollToBottom()
    }
  }, [lines.length, isStreaming, userScrolled, scrollToBottom])

  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (!isAtBottom) {
      setUserScrolled(true)
    } else {
      setUserScrolled(false)
    }
  }

  function copyAll() {
    const text = lines
      .map((l) => `[${formatTimestamp(l.timestamp)}] ${l.line}`)
      .join('\n')
    void navigator.clipboard.writeText(text)
  }

  return (
    <div className="relative flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 rounded-t-lg">
        <div className="flex items-center gap-2">
          {isStreaming && (
            <span className="inline-flex items-center gap-1.5 text-xs text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse-dot" />
              Live
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={copyAll} className="text-zinc-400 hover:text-zinc-200 h-6 text-xs">
          <Copy size={12} />
          Copy all
        </Button>
      </div>

      {/* Log output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-zinc-950 rounded-b-lg p-3 font-mono text-xs leading-relaxed"
        style={{ minHeight: 0 }}
      >
        {lines.length === 0 && (
          <span className="text-zinc-600">No output yet…</span>
        )}
        {lines.map((line, i) => (
          <div key={`${line.seq}-${i}`} className="flex gap-2">
            <span className="text-zinc-600 shrink-0 select-none">
              [{formatTimestamp(line.timestamp)}]
            </span>
            <span className={cn(
              line.stream === 'stderr' ? 'text-amber-400' : 'text-zinc-100',
            )}>
              {line.line}
            </span>
          </div>
        ))}
        {isStreaming && (
          <span className="text-zinc-400 animate-blink ml-0.5">▋</span>
        )}
      </div>

      {/* Jump to bottom button */}
      {isStreaming && userScrolled && (
        <button
          onClick={scrollToBottom}
          className={cn(
            'absolute bottom-4 right-4 flex items-center gap-1.5',
            'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700',
            'rounded-full px-3 py-1 text-xs font-medium shadow-lg transition-colors',
          )}
        >
          <ArrowDown size={12} />
          Jump to bottom
        </button>
      )}
    </div>
  )
}
