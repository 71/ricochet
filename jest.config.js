module.exports = {
  rootDir: '.',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/test/*.ts'
  ],
  globals: {
    'ts-jest': {
      diagnostics: false
    }
  }
}
