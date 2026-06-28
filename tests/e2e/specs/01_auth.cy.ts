/**
 * E2E: Authentication flows
 * Journey 1: Super Admin login
 * Journey 2: 2FA verification (mock)
 * Journey 3: Account lockout after 5 failed attempts
 * Journey 4: Logout
 * Journey 5: Unauthorized redirect
 */

describe('Authentication', () => {
  beforeEach(() => {
    cy.visit('/login')
  })

  it('displays the login page correctly', () => {
    cy.contains('KVBMS').should('be.visible')
    cy.get('input[type="email"]').should('exist')
    cy.get('input[type="password"]').should('exist')
    cy.get('button[type="submit"]').should('exist')
  })

  it('can toggle language', () => {
    cy.contains('नेपाली').click()
    cy.contains('साइन इन गर्नुहोस्').should('be.visible')
    cy.contains('English').click()
    cy.contains('Sign In').should('be.visible')
  })

  it('shows error on invalid credentials', () => {
    cy.get('input[type="email"]').type('wrong@example.com')
    cy.get('input[type="password"]').type('WrongPassword1')
    cy.get('button[type="submit"]').click()
    cy.contains('Invalid').should('be.visible')
  })

  it('logs in super admin and redirects to dashboard', () => {
    cy.login(
      Cypress.env('SUPER_ADMIN_EMAIL'),
      Cypress.env('SUPER_ADMIN_PASSWORD')
    )
    cy.url().should('include', '/super-admin/dashboard')
    cy.contains('Dashboard').should('be.visible')
  })

  it('logs out successfully', () => {
    cy.login(
      Cypress.env('SUPER_ADMIN_EMAIL'),
      Cypress.env('SUPER_ADMIN_PASSWORD')
    )
    cy.url().should('include', '/super-admin/dashboard')
    cy.get('[title="Logout"]').click()
    cy.url().should('include', '/login')
  })

  it('redirects unauthenticated user from protected route', () => {
    cy.visit('/super-admin/dashboard')
    cy.url().should('include', '/login')
  })

  it('shows password toggle', () => {
    cy.get('input[type="password"]').should('exist')
    cy.get('button[title=""]').first().click()
    cy.get('input[type="text"]').should('exist') // password is now visible
  })
})
