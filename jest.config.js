module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.jsx?$': 'babel-jest'
  },
  setupFilesAfterEnv: ['./test/setup-test.js'],
  moduleNameMapper: {
    '\\.(png|jpg|jpeg|gif|svg)$': '<rootDir>/test/mocks/fileMock.js'
  },
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  testMatch: ['**/test/unit/**/*.test.js'],
};
