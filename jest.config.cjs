/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["./jest.setup.js"],
  moduleNameMapper: {
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
    "^~/(.*)$": "<rootDir>/app/$1"
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json'
    }],
    '^.+\\.js$': 'babel-jest',
  },
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "!app/**/*.test.{ts,tsx}",
    "!app/**/__tests__/**",
    "!app/**/node_modules/**"
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};