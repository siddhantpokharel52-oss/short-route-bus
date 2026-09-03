/**
 * Every phone number in this app is stored as a bare 10-digit string (e.g.
 * "9812345678" -- no country code, no dashes/spaces), so every phone input
 * enforces that shape the same way: strip anything that isn't a digit and
 * cap at 10 characters while typing, rather than only flagging it as an
 * error after the fact.
 */
export function sanitizePhoneDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 10)
}

export const PHONE_VALIDATION_MESSAGE = 'Enter a valid 10-digit phone number'

export function isValidPhone(value: string): boolean {
  return /^\d{10}$/.test(value)
}
