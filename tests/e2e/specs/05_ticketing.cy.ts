/**
 * E2E: Ticketing & Revenue
 * Journey 1: Issue a new ticket
 * Journey 2: Verify issued ticket via QR
 * Journey 3: Check payment method selection (Smart Card flow)
 * Journey 4: Revenue summary visible to finance
 * Journey 5: Ticket search by number
 */

describe('Ticketing', () => {
  beforeEach(() => {
    cy.apiLogin(
      Cypress.env('SUPER_ADMIN_EMAIL'),
      Cypress.env('SUPER_ADMIN_PASSWORD')
    )
    cy.visit('/tenant/ticketing')
  })

  it('renders ticketing page', () => {
    cy.contains('Ticketing').should('be.visible')
    cy.contains('Issue Ticket').should('be.visible')
    cy.contains('Verify').should('be.visible')
  })

  it('opens issue ticket modal', () => {
    cy.contains('Issue Ticket').click()
    cy.get('[role="dialog"]').should('be.visible')
    cy.contains('From Stop').should('be.visible')
    cy.contains('To Stop').should('be.visible')
    cy.contains('Payment Method').should('be.visible')
  })

  it('shows smart card field when smart card payment selected', () => {
    cy.contains('Issue Ticket').click()
    cy.get('[role="dialog"]').within(() => {
      cy.get('select').last().select('SMART_CARD')
      cy.contains('Smart Card Number').should('be.visible')
    })
  })

  it('opens verify ticket modal', () => {
    cy.contains('Verify').click()
    cy.get('[role="dialog"]').should('be.visible')
    cy.get('input[placeholder*="TKT"]').should('exist')
  })

  it('searches tickets', () => {
    cy.get('input[placeholder*="Search"]').type('TKT-')
    cy.wait(500)
    cy.get('table').should('exist')
  })

  it('shows ticket table headers', () => {
    cy.get('table thead').within(() => {
      cy.contains('Ticket Number').should('be.visible')
      cy.contains('Passenger').should('be.visible')
      cy.contains('Fare').should('be.visible')
    })
  })
})

describe('Revenue Page', () => {
  beforeEach(() => {
    cy.apiLogin(
      Cypress.env('SUPER_ADMIN_EMAIL'),
      Cypress.env('SUPER_ADMIN_PASSWORD')
    )
    cy.visit('/tenant/revenue')
  })

  it('shows revenue summary', () => {
    cy.contains('Revenue').should('be.visible')
    cy.contains('Daily').should('be.visible')
    cy.contains('Monthly').should('be.visible')
  })

  it('shows revenue charts', () => {
    cy.get('svg.recharts-surface').should('exist')
  })
})
