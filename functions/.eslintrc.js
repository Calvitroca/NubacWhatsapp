module.exports = {
  root: true,
  env: { node: true, es6: true },
  parserOptions: { ecmaVersion: 2020 },
  extends: ["eslint:recommended"],
  rules: {
    "require-jsdoc": "off",
    "max-len": "off",
    indent: "off",
    "object-curly-spacing": "off",
    "comma-dangle": "off",
    "no-unused-vars": "off",
  },
};