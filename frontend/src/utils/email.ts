/**
 * Shared email format check, same convention as phone.ts -- every form that
 * takes an email address validates it the same way instead of each page
 * inventing its own regex.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const EMAIL_VALIDATION_MESSAGE = 'Enter a valid email address'

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value)
}
