/**
 * useGlobalNepaliKeyboard
 *
 * Attaches a single document-level keydown listener (capture phase).
 * When keyboardMode === 'unicode', ALL <input type="text"> and <textarea>
 * elements on the page convert Roman keystrokes to Devanagari in real-time.
 *
 * Approach: prefix / suffix + roman buffer
 *   value = beforeCursor + romanToNepali(romanBuffer) + afterCursor
 *
 * The cursor position is tracked per element. If the user clicks somewhere
 * else or uses arrow keys, the handler detects the drift and recomputes the
 * insertion point before the next keystroke.
 */
import { useEffect, useRef } from 'react'
import { useUiStore } from '@store/uiStore'
import { romanToNepali } from '@utils/nepaliKeyboard'

// Only intercept plain text-like inputs (not date/number/color/file etc.)
const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel'])

function isTextLike(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT')
    return TEXT_TYPES.has((el as HTMLInputElement).type.toLowerCase())
  return false
}

interface ElemState {
  beforeCursor: string
  afterCursor: string
  roman: string
  lastConverted: string // cached romanToNepali(roman)
}

const elemStates = new WeakMap<HTMLElement, ElemState>()

function getState(el: HTMLElement): ElemState {
  return elemStates.get(el) ?? {
    beforeCursor: '',
    afterCursor: '',
    roman: '',
    lastConverted: '',
  }
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  // Fire both — react-hook-form uses onChange which is wired to the native `change` event
  // via React's SyntheticEvent system listening on the root; `input` keeps controlled state in sync.
  el.dispatchEvent(new Event('input',  { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Keys that should pass through unmodified */
const PASSTHROUGH = new Set([
  'Tab', 'Enter', 'Escape', 'CapsLock', 'Shift', 'Control', 'Alt', 'Meta',
  'NumLock', 'ScrollLock', 'Insert', 'ContextMenu', 'PrintScreen', 'Pause',
  'PageUp', 'PageDown',
])

/** Navigation keys — don't intercept, but reset cursor tracking afterwards */
const NAV_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End',
])

export function useGlobalNepaliKeyboard() {
  const keyboardMode = useUiStore((s) => s.keyboardMode)
  const modeRef = useRef(keyboardMode)

  useEffect(() => { modeRef.current = keyboardMode }, [keyboardMode])

  useEffect(() => {
    // ── Mouse click: reset insertion state for the clicked element ──────────
    const onMouseDown = (e: MouseEvent) => {
      if (modeRef.current !== 'unicode') return
      const el = e.target as HTMLElement
      if (!isTextLike(el)) return

      // rAF so the browser has positioned the cursor before we read selectionStart
      requestAnimationFrame(() => {
        if (!isTextLike(el)) return
        const inp = el as HTMLInputElement
        const start = inp.selectionStart ?? inp.value.length
        const end   = inp.selectionEnd   ?? start
        elemStates.set(el, {
          beforeCursor:  inp.value.slice(0, start),
          afterCursor:   inp.value.slice(end),
          roman:         '',
          lastConverted: '',
        })
      })
    }

    // ── Keydown: the core interception ──────────────────────────────────────
    const onKeyDown = (e: KeyboardEvent) => {
      if (modeRef.current !== 'unicode') return
      const el = document.activeElement
      if (!isTextLike(el)) return

      // Let Ctrl/Cmd/Alt combos (copy, paste, select-all, etc.) pass through
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // Function keys
      if (/^F\d{1,2}$/.test(e.key)) return

      // Keys that should pass through unmodified
      if (PASSTHROUGH.has(e.key)) return

      // Navigation: don't intercept, but schedule cursor-drift reset
      if (NAV_KEYS.has(e.key)) {
        requestAnimationFrame(() => {
          if (!isTextLike(document.activeElement)) return
          const inp = document.activeElement as HTMLInputElement
          const start = inp.selectionStart ?? inp.value.length
          const end   = inp.selectionEnd   ?? start
          elemStates.set(inp, {
            beforeCursor:  inp.value.slice(0, start),
            afterCursor:   inp.value.slice(end),
            roman:         '',
            lastConverted: '',
          })
        })
        return
      }

      // ── Drift detection ─────────────────────────────────────────────────
      // If the cursor or value has drifted from where we left off (e.g. user
      // clicked somewhere, or Ctrl+A selected all), recompute prefix/suffix.
      const st = getState(el)
      const actualStart = (el as HTMLInputElement).selectionStart ?? (el as HTMLInputElement).value.length
      const actualEnd   = (el as HTMLInputElement).selectionEnd   ?? actualStart
      const expectedCursor = st.beforeCursor.length + st.lastConverted.length
      const currentValue   = (el as HTMLInputElement).value

      let { beforeCursor, afterCursor, roman } = st
      if (
        actualStart !== expectedCursor ||
        currentValue !== beforeCursor + st.lastConverted + afterCursor
      ) {
        // Cursor moved or value changed externally — reset insertion point
        beforeCursor = currentValue.slice(0, actualStart)
        afterCursor  = currentValue.slice(actualEnd)
        roman = ''
      }

      // ── Intercept the keystroke ─────────────────────────────────────────
      e.preventDefault()

      if (e.key === 'Backspace') {
        if (roman.length > 0) {
          roman = roman.slice(0, -1)
        } else if (beforeCursor.length > 0) {
          // Nothing in the roman buffer: act as a normal backspace on beforeCursor
          beforeCursor = beforeCursor.slice(0, -1)
        }
      } else if (e.key === 'Delete') {
        if (roman.length > 0) {
          roman = ''
        } else {
          afterCursor = afterCursor.slice(1)
        }
      } else if (e.key.length === 1) {
        roman += e.key
      } else {
        return // unhandled special key — let it pass
      }

      const converted = romanToNepali(roman)
      const newValue  = beforeCursor + converted + afterCursor

      elemStates.set(el, { beforeCursor, afterCursor, roman, lastConverted: converted })
      setNativeValue(el as HTMLInputElement, newValue)

      // Restore cursor to the end of the converted region
      const cursorPos = beforeCursor.length + converted.length
      requestAnimationFrame(() => {
        ;(el as HTMLInputElement).setSelectionRange(cursorPos, cursorPos)
      })
    }

    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown',   onKeyDown,   true)

    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown',   onKeyDown,   true)
    }
  }, []) // modeRef handles live updates without re-attaching listeners
}
