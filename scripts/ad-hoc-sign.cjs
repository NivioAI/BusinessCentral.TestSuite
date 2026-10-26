// electron-builder afterPack hook. Without a Developer ID certificate (no CSC_LINK), sign the
// macOS app ad hoc so it starts on Apple Silicon and macOS does not report it as damaged.
// With a certificate, electron-builder signs and notarizes the app itself afterwards.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

exports.default = async function adHocSign(context) {
  if (context.electronPlatformName !== "darwin" || process.env.CSC_LINK) return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`  • signed ad hoc  ${appPath}`);
};
