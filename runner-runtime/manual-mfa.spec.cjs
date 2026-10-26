const { test } = require("@playwright/test");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { playRecording } = require("./node_modules/@microsoft/bc-replay/player/dist/Commands.js");

const startAddress = process.env.bc_player_startAddress;
const recordingPath = process.env.bc_player_tests;
const username = process.env[process.env.bc_player_username_key];
const password = process.env[process.env.bc_player_password_key];
const authenticationTimeout = 5 * 60 * 1000;
const authStatePath = process.env.BCFT_AUTH_STATE_PATH;

if (process.env.BCFT_AUTH_STATE_EXISTS === "1" && authStatePath) {
  test.use({ storageState: authStatePath });
}

if (!startAddress || !recordingPath || !username || !password) {
  throw new Error("Manual MFA is missing the target URL, the recording or the AAD credentials.");
}

test("Handmatige MFA en BC Page Script replay", async ({ page }, testInfo) => {
  const resultDirectory = process.env.bc_player_resultDir;
  if (resultDirectory) {
    writeFileSync(
      join(resultDirectory, "video-timeline.json"),
      JSON.stringify({ videoStartedAt: new Date().toISOString() }),
      { encoding: "utf8", mode: 0o600 },
    );
  }
  await page.goto(startAddress);

  if (!page.url().startsWith(startAddress)) {
    const emailInput = page.locator('input[type="email"]');
    await emailInput.waitFor({ state: "visible", timeout: 120_000 });
    await emailInput.fill(username);
    await page.locator('input[type="submit"]').click();

    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.waitFor({ state: "visible", timeout: 120_000 });
    await passwordInput.fill(password);
    await page.locator('input[type="submit"]').click();

    console.log("MFA required: approve the prompt or enter the code in the browser window.");
    await page.waitForURL((url) => url.href.startsWith(startAddress), {
      timeout: authenticationTimeout,
    });
    console.log("MFA complete. The Microsoft session is remembered.");
  } else {
    console.log("Remembered Microsoft session reused.");
  }

  if (authStatePath) await page.context().storageState({ path: authStatePath });
  console.log("The Business Central recording is starting.");

  await playRecording(
    startAddress,
    page,
    undefined,
    testInfo,
    { path: recordingPath, name: testInfo.title },
    null,
  );
});
