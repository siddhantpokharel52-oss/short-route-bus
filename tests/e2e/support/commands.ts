/// <reference types="cypress" />

// Custom Cypress commands for KVBMS E2E tests

Cypress.Commands.add('login', (email: string, password: string) => {
  cy.visit('/login')
  cy.get('input[type="email"]').type(email)
  cy.get('input[type="password"]').type(password)
  cy.get('button[type="submit"]').click()
  cy.url().should('not.include', '/login')
})

Cypress.Commands.add('loginAsSuperAdmin', () => {
  cy.login(
    Cypress.env('SUPER_ADMIN_EMAIL'),
    Cypress.env('SUPER_ADMIN_PASSWORD')
  )
})

Cypress.Commands.add('apiLogin', (email: string, password: string) => {
  cy.request('POST', `${Cypress.env('API_BASE_URL')}/auth/token/`, {
    email,
    password,
  }).then((response) => {
    window.localStorage.setItem('kvbms_auth', JSON.stringify({
      state: {
        accessToken: response.body.data.access,
        refreshToken: response.body.data.refresh,
        isAuthenticated: true,
        user: {
          email,
          role: response.body.data.role,
          fullName: response.body.data.full_name,
          tenantSchema: response.body.data.tenant_schema,
          language: response.body.data.language,
        },
      },
    }))
  })
})

declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>
      loginAsSuperAdmin(): Chainable<void>
      apiLogin(email: string, password: string): Chainable<void>
    }
  }
}

export {}
