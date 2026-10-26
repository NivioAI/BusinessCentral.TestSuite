const upstream = require("./node_modules/@microsoft/bc-replay/player/dist/playwright.config.js");

module.exports = {
  ...upstream.default,
  testDir: __dirname,
  timeout: 7 * 60 * 1000,
};
