import { defineConfig, devices } from "@playwright/test";

/**
 * E2E: ทดสอบขั้นตอนนำเข้าบนหน้าจอมือถือ (Android / Pixel 7)
 * รัน: npm run test:e2e  (build แล้วเปิด next start ที่พอร์ต 3210)
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3210",
    trace: "off",
  },
  projects: [{ name: "android-pixel-7", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "npx next start -p 3210",
    url: "http://localhost:3210",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
