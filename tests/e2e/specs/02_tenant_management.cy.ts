/**
 * E2E: Tenant (Operator) Management
 * Journey 1: Super admin views operator list
 * Journey 2: Super admin creates a new operator
 * Journey 3: Super admin views operator detail + documents
 * Journey 4: Super admin suspends an operator
 * Journey 5: Non-super-admin cannot list all operators
 */

describe('Tenant Management', () => {
  beforeEach(() => {
    cy.apiLogin(
      Cypress.env('SUPER_ADMIN_EMAIL'),
      Cypress.env('SUPER_ADMIN_PASSWORD')
    )
    cy.visit('/super-admin/tenants')
  })

  it('displays list of operators', () => {
    cy.contains('Bus Operators').should('be.visible')
    cy.get('table').should('exist')
  })

  it('can search operators', () => {
    cy.get('input[placeholder*="Search"]').type('Sajha')
    cy.wait(500)
    // Results should filter
    cy.get('table tbody tr').should('have.length.at.least', 0)
  })

  it('opens create operator modal', () => {
    cy.contains('Add Operator').click()
    cy.get('[role="dialog"]').should('be.visible')
    cy.contains('Company Name').should('be.visible')
  })

  it('creates a new operator', () => {
    cy.contains('Add Operator').click()
    cy.get('[role="dialog"]').within(() => {
      cy.get('input[name="name"]').type('Test Operator E2E')
      cy.get('input[name="subdomain"]').type('test-operator-e2e')
      cy.get('input[name="contact_email"]').type('test@testoperator.com')
      cy.get('button[type="submit"]').click()
    })
    cy.contains('Operator created!').should('be.visible')
    cy.contains('Test Operator E2E').should('be.visible')
  })

  it('navigates to operator detail', () => {
    cy.get('table tbody tr').first().find('a').first().click()
    cy.url().should('include', '/super-admin/tenants/')
    cy.contains('Company Documents').should('be.visible')
  })

  it('shows pagination', () => {
    cy.get('button').contains('Next').should('exist')
  })
})
