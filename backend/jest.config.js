/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Tests live in a separate test/ tree that mirrors src/. ts-jest uses tsconfig.test.json (rootDir
  // covers both src and test, and decorator metadata is inherited for NestJS DI).
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
