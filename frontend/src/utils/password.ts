/**
 * Shared password complexity check, same convention as phone.ts/email.ts --
 * every form that SETS a password (create-login, change-password, tenant
 * admin creation) validates it the same way. Does not apply to a plain
 * sign-in form, where the field holds an already-existing password rather
 * than a new one being created.
 */
export const PASSWORD_VALIDATION_MESSAGE =
  'Must be at least 10 characters and include an uppercase letter, a lowercase letter, a number, and a special character'

export function isValidPassword(value: string): boolean {
  return (
    value.length >= 10 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  )
}
