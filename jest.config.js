module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
    '^expo-secure-store$': '<rootDir>/jest-mocks/native-module.js',
    '^react-native-get-random-values$': '<rootDir>/jest-mocks/native-module.js',
  },
};
