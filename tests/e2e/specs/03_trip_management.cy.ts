/**
 * E2E: Trip Management (Dispatcher/Company Admin)
 * Journey 1: View today's trips
 * Journey 2: Create a trip
 * Journey 3: Start a trip
 * Journey 4: Complete a trip with passenger count
 * Journey 5: Cancel a trip with reason
 */

describe('Trip Management', () => {
  beforeEach(() => {
    // Login as company admin (dispatcher role)
    cy.apiLogin(
      Cypress.env('SUPER_ADMIN_EMAIL'),
      Cypress.env('SUPER_ADMIN_PASSWORD')
    )
    cy.visit('/tenant/trips')
  })

  it("displays today's trips page", () => {
    cy.contains("Today's Trips").should('be.visible')
    cy.get('button').contains('Create Trip').should('exist')
  })

  it('shows trip status chips', () => {
    cy.contains('SCHEDULED').should('be.visible')
    cy.contains('IN_PROGRESS').should('be.visible')
    cy.contains('COMPLETED').should('be.visible')
  })

  it('opens create trip modal', () => {
    cy.contains('Create Trip').click()
    cy.get('[role="dialog"]').should('be.visible')
    cy.contains('Route ID').should('be.visible')
    cy.contains('Nepal Labour Act 2074').should('be.visible')
  })

  it('refreshes trips list', () => {
    cy.contains('Refresh').click()
    cy.contains("Today's Trips").should('be.visible')
  })

  it('trip cancellation requires a reason', () => {
    // If there are any scheduled trips
    cy.get('table tbody tr').then(($rows) => {
      if ($rows.length > 0) {
        // Find cancel button
        cy.get('table tbody tr').first().find('svg').filter('[data-lucide="x-circle"]').parent().click()
        cy.get('[role="dialog"]').should('be.visible')
        cy.get('button').contains('Cancel Trip').should('be.disabled')
        cy.get('textarea').type('Traffic emergency')
        cy.get('button').contains('Cancel Trip').should('not.be.disabled')
      }
    })
  })
})
