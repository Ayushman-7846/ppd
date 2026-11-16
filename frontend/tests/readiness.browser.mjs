import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const base = process.env.RESEARCH_BASE_URL ?? "http://localhost:3000";
const captures = process.env.RESEARCH_QUALITY_CAPTURES;
const browser = await chromium.launch({ channel: process.env.RESEARCH_BROWSER_CHANNEL, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(22_000);
const failures = [];
const timings = [];
page.on("pageerror", (error) => failures.push({ path: page.url(), message: error.message }));
page.on("console", (entry) => {
  if (entry.type() === "error" && !entry.text().match(/401 \(Unauthorized\)/)) {
    failures.push({ path: page.url(), message: entry.text() });
  }
});

async function go(path, heading) {
  const started = performance.now();
  const response = await page.goto(base + path);
  assert.equal(response.status(), 200, path);
  assert.equal(response.headers()["x-content-type-options"], "nosniff");
  assert.equal(response.headers()["x-frame-options"], "DENY");
  await page.getByRole("heading", { level: 1, name: heading, exact: true }).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const resources = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter((entry) => entry.name.includes("/_next/static/") && entry.name.endsWith(".js"))
    .reduce((sum, entry) => sum + entry.encodedBodySize, 0));
  timings.push({ path, width: page.viewportSize().width, headingMs: Math.round(performance.now() - started), jsBytes: resources });
}

async function check(path, heading, filename) {
  await go(path, heading);
  if (path === "/lab") await page.getByText("Recorded live experiments", { exact: true }).waitFor();
  if (path === "/lab/settings") await page.getByRole("heading", { name: "Provider diagnostics" }).waitFor();
  if (["/lab/ambiguity", "/lab/recursion", "/lab/movement", "/lab/phonology"].includes(path)) {
    await page.getByRole("heading", { name: "Input and model" }).waitFor();
  }
  const width = page.viewportSize().width;
  const actual = await page.evaluate(() => document.documentElement.scrollWidth);
  if (actual > width) failures.push({ path, width, overflow: actual - width });
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  for (const violation of scan.violations) failures.push({ path, width, rule: violation.id, elements: violation.nodes.map((node) => node.target) });
  if (captures && filename) await page.screenshot({ path: join(captures, filename) });
}

const pages = [
  ["/lab", "Research Dashboard"], ["/lab/showcase", "Research Showcase"],
  ["/lab/experiments", "Experiment Laboratory"], ["/lab/ambiguity", "Syntactic ambiguity"],
  ["/lab/recursion", "Linguistic recursion"], ["/lab/movement", "Syntactic movement"],
  ["/lab/phonology", "Phonological generalization"], ["/lab/datasets", "Dataset Studio"],
  ["/lab/prompts", "Prompt Studio"], ["/lab/settings", "Settings"],
  ["/lab/evaluation", "Evaluation Center"], ["/lab/comparison", "Model Comparison"],
  ["/lab/consistency", "Consistency Laboratory"], ["/lab/analytics", "Research Analytics"],
  ["/lab/leaderboard", "Model Leaderboard"], ["/lab/reports", "Research Reports"], ["/lab/errors", "Error Explorer"],
];
try {
  if (captures) await mkdir(captures, { recursive: true });
  await page.goto(base + "/");
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("link", { name: "Skip to content" }).evaluate((link) => link === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "main");
  const landingHeading = await page.locator("h1").innerText();
  await check("/", landingHeading, "landing-1440.png");
  await page.goto(base + "/workspace");
  const loginHeading = "Sign in to LinguaLens";
  await check("/workspace", loginHeading, "authentication-1440.png");
  await page.getByRole("button", { name: "Create a researcher account" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Readiness audit");
  await page.getByLabel("Email", { exact: true }).fill(`readiness-${randomUUID()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "My workspace", exact: true }).waitFor();

  for (const [path, heading] of pages) {
    await check(path, heading, captures ? `${path.split("/").at(-1)}-1440.png` : undefined);
  }
  await go("/lab/evaluation", "Evaluation Center");
  await page.getByRole("button", { name: "Human review", exact: true }).click();
  await page.getByRole("heading", { name: "Review queue" }).waitFor();
  for (const violation of (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations) {
    failures.push({ path: "/lab/evaluation (human review)", width: page.viewportSize().width, rule: violation.id,
      elements: violation.nodes.map((node) => node.target) });
  }
  await go("/lab/showcase", "Research Showcase");
  await page.getByRole("link", { name: "Review the featured experiment" }).click();
  await page.getByText(/Curated demonstration.*40-trial/).waitFor();
  assert.equal(await page.getByLabel("Repetitions per item and model").inputValue(), "2");
  await page.waitForFunction(() => [...document.querySelectorAll('select[aria-label="AI model"]')].at(-1)?.value === "demo|lingualens-baseline");
  assert.equal(await page.getByLabel("AI model", { exact: true }).last().inputValue(), "demo|lingualens-baseline");

  for (const width of [1200, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, heading] of pages.filter(([path]) => ["/lab/showcase", "/lab/experiments", "/lab/evaluation", "/lab/reports"].includes(path))) {
      await check(path, heading, `${path.split("/").at(-1)}-${width}.png`);
    }
  }
  await go("/lab/showcase", "Research Showcase");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Workspace navigation" }).waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.closest("dialog")?.open), true);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Workspace navigation" }).waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await check("/lab/showcase", "Research Showcase", "showcase-light-1440.png");
  await check("/lab/settings", "Settings", "settings-light-1440.png");
  console.log(JSON.stringify({ visits: timings.length, timings, failures }, null, 2));
  assert.deepEqual(failures, []);
} catch (error) {
  if (failures.length) console.error(JSON.stringify({ failedAt: page.url(), failures }, null, 2));
  throw error;
} finally {
  await browser.close();
}
