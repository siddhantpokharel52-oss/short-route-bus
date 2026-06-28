import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    viewportWidth: 1280,
    viewportHeight: 720,
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 10000,
    env: {
      SUPER_ADMIN_EMAIL: 'admin@kvbms.com.np',
      SUPER_ADMIN_PASSWORD: 'Admin@123456',
      API_BASE_URL: 'http://localhost:8000/api/v1',
    },
    specPattern: 'tests/e2e/specs/**/*.cy.ts',
    supportFile: 'tests/e2e/support/commands.ts',
  },
  component: {
    devServer: {
      framework: 'react',
      bundler: 'vite',
    },
    specPattern: 'frontend/src/**/*.cy.tsx',
  },
})
