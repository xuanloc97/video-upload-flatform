/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Tests live in a separate test/ tree that mirrors src/. ts-jest uses tsconfig.test.json (rootDir
  // covers both src and test) so imports like ../src/storage type-check without a rootDir error.
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
