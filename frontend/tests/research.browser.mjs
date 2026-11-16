import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.RESEARCH_BASE_URL ?? "http://localhost:3000";
const capture = process.env.RESEARCH_SCREENSHOTS_DIR;
const browser = await chromium.launch({ channel: process.env.RESEARCH_BROWSER_CHANNEL, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: "reduce" });
page.setDefaultTimeout(18_000);
const faults = [];
page.on("pageerror", (error) => faults.push(`${page.url()} ${error.message}`));
const nonce = randomUUID().slice(0, 8);
const go = async (path) => {
  const response = await page.goto(base + path);
  assert.equal(response.status(), 200, path);
};

async function screenshot(name, options = {}) {
  if (!capture) return;
  await mkdir(capture, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(capture, name), ...options });
}

try {
  await go("/");
  await page.getByRole("button", { name: "Noun phrase" }).click();
  await page.getByText("The telescope belongs to the astronomer.").waitFor();
  await go("/lab/comparison");
  await page.getByText("Demo mode · Synthetic data", { exact: true }).waitFor();
  const demoPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download demo CSV" }).click();
  assert.equal((await demoPending).suggestedFilename(), "lingualens-demo-scores.csv");
  await go("/lab/ambiguity");
  await page.getByRole("button", { name: "Reveal demo annotation" }).click();
  await page.getByText("Loaded from the demo API").waitFor();
  await go("/workspace");
  await page.getByRole("button", { name: "Create a researcher account" }).click();
  await page.getByLabel("Name", { exact: true }).fill("LinguaLens browser test");
  await page.getByLabel("Email", { exact: true }).fill(`lingualens-${nonce}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "My workspace", exact: true }).waitFor();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByRole("heading", { name: "Research Dashboard" }).waitFor();

  await page.getByRole("link", { name: "Ambiguity Analysis", exact: true }).click();
  await page.getByLabel("AI model", { exact: true }).selectOption("demo|lingualens-reference");
  let allowResult;
  const gate = new Promise((resolve) => { allowResult = resolve; });
  await page.route(/\/api\/v1\/responses\/\d+$/, async (route) => {
    await gate;
    await route.continue();
  }, { times: 1 });
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  try { await page.getByText("Waiting for the research worker…", { exact: true }).waitFor(); }
  finally { allowResult(); }
  await page.getByText("Demo · Curated reference", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "VP attachment", exact: true }).waitFor();
  await page.getByText("2 readings", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Compare trees" }).click();
  await page.getByRole("heading", { name: "NP attachment", exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot("LinguaLens-analyzer.png");
  await page.getByRole("button", { name: "Reading 1", exact: true }).click();
  const viewer = page.locator(".interactive-tree").filter({ hasText: "Reading 1 tree" });
  await viewer.getByRole("button", { name: "TP", exact: true }).focus();
  await page.keyboard.press("Enter");
  await viewer.getByRole("button", { name: "Collapse branch", exact: true }).click();
  await viewer.getByRole("button", { name: "Expand branch", exact: true }).click();
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  const canvas = viewer.locator(".interactive-tree-svg");
  const zoomed = await canvas.getAttribute("viewBox");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  const panned = await canvas.getAttribute("viewBox");
  assert.notEqual(panned, zoomed);
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + 8, bounds.y + 8);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 32, bounds.y + 22, { steps: 3 });
  await page.mouse.up();
  assert.notEqual(await canvas.getAttribute("viewBox"), panned);
  await viewer.getByRole("button", { name: "Fit tree to screen", exact: true }).click();
  if (await page.evaluate(() => document.fullscreenEnabled)) {
    await viewer.getByRole("button", { name: "Fullscreen tree", exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains("interactive-tree"));
    await viewer.getByRole("button", { name: "Fullscreen tree", exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    process.stdout.write("Fullscreen tree entry and exit passed.\n");
  }
  for (const format of ["SVG", "PNG"]) {
    const wait = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "Export " + format, exact: true }).click();
    const download = await wait;
    assert.equal(download.suggestedFilename(), "lingualens-tree." + format.toLowerCase());
    assert.equal(await download.failure(), null);
  }
  const history = page.locator(".analysis-history");
  await history.getByRole("button", { name: "I saw the astronomer with the telescope.", exact: true }).click();
  await history.getByRole("button", { name: "Re-run", exact: true }).click();
  await history.getByRole("button", { name: "Compare", exact: true }).first().click();
  await page.getByRole("heading", { name: "Compare saved analyses" }).waitFor();
  await page.getByRole("button", { name: "Close comparison" }).click();
  await page.getByLabel("Input source").selectOption("manual");
  await page.getByLabel("Sentence", { exact: true }).fill("This sentence was written for the failure test.");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await page.getByText(/Demo mode supports the curated examples/).first().waitFor();
  await history.getByLabel("Status", { exact: true }).selectOption("failed");
  await history.getByRole("button", { name: "This sentence was written for the failure test.", exact: true }).waitFor();

  for (const [path, evidence] of [
    ["recursion", "Model-estimated depth"], ["movement", "Original position"], ["phonology", "Verified on supplied examples"],
  ]) {
    await go("/lab/" + path);
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await page.getByText(evidence, { exact: true }).waitFor();
  }
  await page.getByLabel("Test an unseen word").fill("f ə b");
  await page.getByRole("button", { name: "Apply substitution" }).click();
  await page.getByText("f ə p", { exact: true }).waitFor();
  await screenshot("LinguaLens-phonology.png");

  await go("/lab/settings");
  await page.getByRole("heading", { name: "AI Model Configuration" }).waitFor();
  const providers = page.getByLabel("AI provider", { exact: true });
  await providers.waitFor();
  assert.equal(await providers.locator("option").count(), 5);
  await providers.selectOption("openai");
  if (await page.getByText("Credentials needed", { exact: true }).count()) {
    await page.getByRole("button", { name: "Test connection" }).click();
    await page.getByRole("alert").getByText("Provider not configured. Please add valid API credentials.").waitFor();
  }
  await providers.selectOption("ollama");
  const localModel = "browser-test-model";
  await page.getByLabel("Default model identifier", { exact: true }).fill(localModel);
  await page.getByRole("button", { name: "Save configuration" }).click();
  await page.getByText("Model configuration saved", { exact: true }).waitFor();
  await go("/lab/ambiguity");
  await page.getByLabel("AI model", { exact: true }).selectOption("ollama|" + localModel);
  await page.getByText("Live execution", { exact: true }).waitFor();
  await page.getByLabel("AI model", { exact: true }).selectOption("demo|lingualens-reference");
  await page.getByText("Demo execution · Curated reference", { exact: true }).waitFor();
  await page.getByLabel("AI model", { exact: true }).selectOption("demo|lingualens-baseline");
  await page.getByText("Demo execution · Simplified baseline", { exact: true }).waitFor();

  await go("/lab/datasets");
  await page.getByRole("button", { name: "Import CSV / JSON" }).click();
  await page.getByLabel("Dataset name").fill("Browser CSV " + nonce);
  await page.getByLabel("Dataset file").setInputFiles({
    name: "examples.csv", mimeType: "text/csv",
    buffer: Buffer.from("item_key,sentence\ncase-01,I saw the astronomer with the telescope.\n"),
  });
  await page.getByRole("button", { name: "Import dataset", exact: true }).click();
  await page.getByRole("heading", { name: "Browser CSV " + nonce, exact: true }).waitFor();
  await page.getByRole("button", { name: "Import CSV / JSON" }).click();
  await page.getByLabel("Dataset name").fill("Browser JSON " + nonce);
  await page.getByLabel("Dataset file").setInputFiles({
    name: "examples.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([{ item_key: "b-01", stimulus: { sentence: "I saw the astronomer with the telescope." } }])),
  });
  await page.getByRole("button", { name: "Import dataset", exact: true }).click();
  await page.getByRole("heading", { name: "Browser JSON " + nonce, exact: true }).waitFor();

  await go("/lab/prompts");
  await page.getByRole("button", { name: "New template" }).click();
  await page.getByLabel("Template name").fill("Browser protocol " + nonce);
  await page.getByLabel("Template body").fill("Analyze $sentence using $analysis_requirements.");
  await page.getByRole("button", { name: "Save new version" }).click();
  await page.getByText("Prompt version 1 saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Preview rendered prompt" }).click();
  await page.getByText("Rendered prompt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Test saved prompt" }).click();
  await page.getByRole("heading", { name: "Prompt test result" }).waitFor();
  await page.getByRole("heading", { name: "VP attachment", exact: true }).waitFor();

  await go("/lab/experiments");
  await page.getByLabel("Experiment name").fill("Repeated research " + nonce);
  await page.getByRole("group", { name: "Datasets and dimensions" }).getByText("Recursive structures", { exact: false }).click();
  await page.getByLabel("Repetitions per item and model").fill("2");
  await page.getByRole("button", { name: "Review experiment", exact: true }).click();
  await page.getByRole("heading", { name: "Review settings", exact: true }).waitFor();
  await page.getByRole("button", { name: "Start experiment", exact: true }).click();
  await page.getByText("Settled trials 40 / 40", { exact: true }).waitFor();
  await page.locator(".experiment-monitor").getByText("40 completed", { exact: true }).first().waitFor();
  await page.locator(".experiment-monitor").getByRole("button", { name: /recursion-/ }).first().click();
  await page.getByRole("heading", { name: "Trial response", exact: true }).waitFor();
  await page.getByText("Model-estimated depth", { exact: true }).waitFor();
  await screenshot("LinguaLens-experiment.png");

  await page.setViewportSize({ width: 390, height: 840 });
  await go("/lab/ambiguity");
  await page.getByRole("heading", { name: "Input and model" }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Recursion Analysis", exact: true }).click();
  await page.getByRole("heading", { name: "Input and model" }).waitFor();
  assert.match(page.url(), /\/lab\/recursion$/);
  assert.deepEqual(faults, []);
  process.stdout.write("Passed research browser workflow on desktop and mobile.\n");
} catch (error) {
  await screenshot("LinguaLens-browser-failure.png", { fullPage: true });
  console.error("Workflow failed at " + page.url());
  console.error((await page.locator("main").innerText().catch(() => "")).slice(0, 4000));
  throw error;
} finally {
  await browser.close();
}
