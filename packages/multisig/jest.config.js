module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node', // or 'node' depending on your use-case
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest'
  },
  // Transform everything in node_modules except cbor2
  transformIgnorePatterns: ["/node_modules/(?!cbor2)"],
};
