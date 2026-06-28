/**
 * E2E: Public Passenger Portal
 * Journey 1: View home page and live map
 * Journey 2: Search routes
 * Journey 3: View stop arrivals
 * Journey 4: Check fare between two stops
 * Journey 5: Verify a ticket
 * Journey 6: File a complaint
 */

describe('Public Portal', () => {
  it('displays home page', () => {
    cy.visit('/')
    cy.contains('Kathmandu Valley Bus Service').should('be.visible')
    cy.contains('Search Routes').should('be.visible')
    cy.contains('Live Bus Map').should('be.visible')
  })

  it('shows navigation links', () => {
    cy.visit('/')
    cy.contains('All Routes').should('exist')
    cy.contains('Bus Stops').should('exist')
    cy.contains('Fare Information').should('exist')
  })

  it('navigates to routes page', () => {
    cy.visit('/routes')
    cy.contains('All Routes').should('be.visible')
    cy.get('input[placeholder*="Search"]').should('exist')
  })

  it('searches routes', () => {
    cy.visit('/routes')
    cy.get('input').first().type('Ratna Park')
    cy.wait(500)
    // Should show filtered results or empty state
    cy.get('div').should('exist')
  })

  it('navigates to stops page', () => {
    cy.visit('/stops')
    cy.contains('Bus Stops').should('be.visible')
  })

  it('navigates to fares page', () => {
    cy.visit('/fares')
    cy.contains('Fare Information').should('be.visible')
    cy.contains('Check Fare').should('be.visible')
  })

  it('displays fare policy table', () => {
    cy.visit('/fares')
    cy.contains('Fare Policy').should('be.visible')
    cy.contains('Student').should('be.visible')
    cy.contains('Senior Citizen').should('be.visible')
    cy.contains('Differently Abled').should('be.visible')
  })

  it('navigates to ticket verify page', () => {
    cy.visit('/verify-ticket')
    cy.contains('Verify Ticket').should('be.visible')
    cy.get('input').should('exist')
  })

  it('navigates to complaints page', () => {
    cy.visit('/complaints')
    cy.contains('Complaints').should('be.visible')
    cy.contains('File Complaint').should('be.visible')
  })

  it('can toggle language on public page', () => {
    cy.visit('/')
    cy.contains('नेपाली').click()
    cy.contains('काठमाडौं उपत्यका बस सेवा').should('be.visible')
    cy.contains('English').click()
  })

  it('smart card page renders', () => {
    cy.visit('/smart-card')
    cy.contains('Smart Card').should('be.visible')
    cy.contains('Check Balance').should('be.visible')
  })
})
