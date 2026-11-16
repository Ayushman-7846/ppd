import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.RESEARCH_BASE_URL ?? "http://localhost:3000";
const capture = process.env.RESEARCH_SCREENSHOTS_DIR;
const database = process.env.RESEARCH_EVALUATION_TEST_DATABASE;
if (!database || !database.includes("phase3-browser")) throw new Error("Set RESEARCH_EVALUATION_TEST_DATABASE to the isolated phase3-browser database used by the API.");
const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
const python = process.env.RESEARCH_TEST_PYTHON || (process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
const browser = await chromium.launch({ channel: process.env.RESEARCH_BROWSER_CHANNEL || undefined, headless: true });
const pages = [];
const errors = [];
const nonce = randomUUID().slice(0, 9);

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 970 }, reducedMotion: "reduce", acceptDownloads: true });
  page.setDefaultTimeout(28_000);
  page.on("pageerror", (error) => errors.push(page.url() + " " + error.message));
  pages.push(page);
  return page;
}

async function go(page, location) {
  const response = await page.goto(base + location);
  assert.equal(response.status(), 200, location);
}

async function capturePage(page, name) {
  if (!capture) return;
  await mkdir(capture, { recursive: true });
  await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; });
  await page.screenshot({ path: join(capture, name) });
}

async function register(page, name, role) {
  await go(page, "/workspace");
  await page.getByRole("button", { name: "Create a researcher account" }).click();
  const email = `${name.toLowerCase().replaceAll(" ", "-")}-${nonce}@example.com`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "My workspace", exact: true }).waitFor();
  const change = spawnSync(resolve(backend, python), ["-m", "app.reviewer_roles", email, role], {
    cwd: backend, env: { ...process.env, DATABASE_URL: database }, encoding: "utf-8",
  });
  assert.equal(change.status, 0, change.stderr || String(change.error ?? ""));
  return email;
}

const owner = await newPage();
try {
  await register(owner, "LinguaLens Demonstration Researcher", "admin");
  const first = await newPage(), second = await newPage();
  const firstEmail = await register(first, "Reviewer One", "reviewer");
  const secondEmail = await register(second, "Reviewer Two", "reviewer");
  const experiment = "Attachment reliability demonstration " + nonce;
  const rubric = "Deterministic reference rubric " + nonce;
  const dataset = "Attachment evidence " + nonce;
  const prompt = "Attachment protocol " + nonce;
  await go(owner, "/lab/datasets");
  await owner.getByRole("button", { name: /PP attachment cases/ }).click();
  await owner.getByLabel("Duplicate as").fill(dataset);
  await owner.getByRole("button", { name: "Duplicate", exact: true }).click();
  await owner.getByRole("heading", { name: dataset, exact: true }).waitFor();
  await go(owner, "/lab/prompts");
  await owner.getByRole("button", { name: "New template" }).click();
  await owner.getByLabel("Template name").fill(prompt);
  await owner.getByLabel("Template body").fill("Analyze $sentence using $analysis_requirements.");
  await owner.getByRole("button", { name: "Save new version" }).click();
  await owner.getByText("Prompt version 1 saved", { exact: true }).waitFor();
  await go(owner, "/lab/experiments");
  await owner.getByLabel("Experiment name").fill(experiment);
  const group = owner.getByRole("group", { name: "Datasets and dimensions" });
  await group.getByText("PP attachment cases", { exact: false }).click();
  await group.getByText(dataset, { exact: false }).click();
  await owner.getByText("Prompt versions", { exact: true }).click();
  await owner.getByLabel("Prompt version", { exact: true }).selectOption({ label: prompt + " · v1" });
  await owner.getByLabel("Repetitions per item and model").fill("2");
  await owner.getByRole("button", { name: "Add model" }).click();
  await owner.getByLabel("AI model", { exact: true }).last().selectOption("demo|lingualens-baseline");
  await owner.getByRole("button", { name: "Review experiment" }).click();
  await owner.getByRole("button", { name: "Start experiment" }).click();
  await owner.getByText("Settled trials 40 / 40", { exact: true }).waitFor();

  await go(owner, "/lab/evaluation");
  await owner.getByRole("button", { name: "Rubric versions", exact: true }).click();
  await owner.getByLabel("Rubric name").fill(rubric);
  for (const [field, value] of [["Correctness", "70"], ["Linguistic analysis quality", "0"], ["Explanation quality", "0"],
    ["Structural validity", "20"], ["Completeness", "10"]]) await owner.getByLabel(field + " weight", { exact: true }).fill(value);
  await owner.getByRole("button", { name: "Save rubric version", exact: true }).click();
  await owner.getByText("Rubric version 1 saved", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "Automated evaluation", exact: true }).click();
  await owner.getByLabel("Experiment", { exact: true }).selectOption({ label: experiment });
  await owner.getByRole("button", { name: "Select eligible page" }).click();
  await owner.getByRole("button", { name: "Next", exact: true }).first().click();
  await owner.getByText("Page 2 · 40 records", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "Select eligible page" }).click();
  await owner.getByLabel("Rubric version", { exact: true }).selectOption({ label: rubric + " · v1" });
  await owner.getByRole("button", { name: "Run evaluation · 40" }).click();
  await owner.getByRole("heading", { name: "Evaluation evidence" }).waitFor();
  await owner.getByText(/Weighted score (100|30)/).first().waitFor();
  await owner.waitForFunction(async () => {
    const records = await Promise.all([1, 2].map((page) => fetch("/api/v1/evaluations?page=" + page).then((response) => response.json())));
    return records.every(({ data }) => data.items.length === 20 && data.items.every(({ state }) => state === "completed"));
  }, undefined, { polling: 400 });
  await capturePage(owner, "LinguaLens-Phase3-evaluation.png");
  await owner.getByRole("button", { name: "Assign human review", exact: true }).click();
  await owner.getByRole("heading", { name: "Assign a human reviewer" }).waitFor();
  const responseId = (await owner.getByLabel("Response ID", { exact: true }).inputValue());
  assert.ok(Number(responseId) > 0);
  await owner.getByLabel("Rubric version").selectOption({ label: rubric + " · v1" });
  for (const email of [firstEmail, secondEmail]) {
    await owner.getByLabel("Reviewer email", { exact: true }).fill(email);
    await owner.getByRole("button", { name: "Assign review", exact: true }).click();
    await owner.getByLabel("Reviewer email", { exact: true }).waitFor();
    await owner.waitForFunction(() => [...document.querySelectorAll('input[type=email]')].some((input) => !input.value));
  }

  async function review(page, verdict, score, comment) {
    await go(page, "/lab/evaluation");
    await page.getByRole("button", { name: "Human review", exact: true }).click();
    await page.getByRole("button", { name: "Assigned to me", exact: true }).click();
    await page.getByRole("button", { name: /ambiguity-\d+ · ambiguity/ }).click();
    await page.getByText("Model metadata hidden", { exact: true }).waitFor();
    for (const label of ["Correctness", "Linguistic analysis quality", "Explanation quality", "Structural validity", "Completeness"]) {
      await page.getByLabel(label, { exact: true }).fill(score);
    }
    await page.getByLabel("Verdict", { exact: true }).selectOption(verdict);
    await page.getByLabel("Reviewer feedback").fill(comment);
    if (verdict === "correct") {
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await page.getByText("Review draft saved", { exact: true }).waitFor();
    }
    await page.getByRole("button", { name: "Submit review", exact: true }).click();
    await page.getByRole("heading", { name: "Review consensus", exact: true }).waitFor();
    assert.equal(await page.getByText("Model metadata hidden", { exact: true }).count(), 0);
  }

  await review(first, "correct", "90", "The recorded parses support the intended reading.");
  await review(second, "incorrect", "40", "The second reader interpreted the evidence differently.");
  await owner.getByRole("button", { name: "Disagreements", exact: true }).click();
  const agreementPanel = owner.locator("section").filter({ has: owner.getByRole("heading", { name: "Reviewer agreement", exact: true }) });
  await agreementPanel.getByText("Recorded live responses", { exact: true }).waitFor();
  await agreementPanel.getByLabel("Rubric version").selectOption({ label: rubric + " · v1" });
  await agreementPanel.getByLabel("Agreement data source").selectOption("demo");
  await agreementPanel.getByText("Curated demonstration data", { exact: true }).waitFor();
  await agreementPanel.getByText("1 decisive pair", { exact: true }).waitFor();
  await owner.getByRole("button", { name: new RegExp("Response " + responseId + " · Rubric") }).click();
  await owner.getByText("Majority —", { exact: true }).waitFor();
  await owner.getByLabel("Adjudicated verdict").selectOption("correct");
  await owner.getByLabel("Adjudication justification").fill("For this demonstration, the adjudicator accepted the attachment analysis.");
  await owner.getByRole("button", { name: "Resolve disagreement" }).click();
  await owner.getByText("Final verdict correct", { exact: true }).waitFor();

  async function filter(page) {
    await page.getByLabel("Data source").selectOption("demo");
    await page.getByLabel("Rubric version", { exact: true }).selectOption({ label: rubric + " · v1" });
  }

  await go(owner, "/lab/comparison");
  await filter(owner);
  await owner.getByRole("button", { name: "Compare models", exact: true }).click();
  await owner.getByRole("heading", { name: "Performance heatmap" }).waitFor();
  await owner.getByRole("table").first().getByText("lingualens-reference", { exact: false }).first().waitFor();
  await owner.getByRole("heading", { name: "Calculated observations" }).waitFor();
  const radar = owner.locator(".science-chart[aria-label='Criterion radar']");
  await radar.getByText("Completeness", { exact: true }).waitFor();
  assert.equal(await radar.getByText("Explanation", { exact: true }).count(), 0);
  assert.equal(await radar.getByText("Analysis", { exact: true }).count(), 0);
  await owner.getByLabel("Test item", { exact: true }).selectOption({ label: "ambiguity-01 · ambiguity" });
  await owner.locator(".science-response-pane").first().waitFor();
  assert.equal(await owner.locator(".science-response-pane").count(), 2);
  await capturePage(owner, "LinguaLens-Phase3-comparison.png");

  await go(owner, "/lab/errors");
  await owner.getByRole("button", { name: /^Open \d+$/ }).first().click();
  await owner.getByRole("heading", { name: /^Original response/ }).waitFor();
  await owner.locator("section").filter({ has: owner.getByRole("heading", { name: /^Original response/ }) }).locator("pre").waitFor();
  await owner.getByRole("button", { name: /^Confirm annotation/ }).first().click();

  await go(owner, "/lab/consistency");
  await filter(owner);
  await owner.getByRole("button", { name: "Analyze repetitions" }).click();
  await owner.getByRole("heading", { name: "Pairwise structural matrix" }).waitFor();
  await owner.getByRole("button", { name: "Save cohort snapshot" }).click();
  await owner.getByText("Research snapshot saved", { exact: true }).waitFor();

  await go(owner, "/lab/analytics");
  await filter(owner);
  await owner.getByRole("button", { name: "Calculate analytics" }).click();
  await owner.getByRole("heading", { name: "Statistical definitions" }).waitFor();
  await owner.getByRole("heading", { name: "Dataset difficulty" }).waitFor();
  await capturePage(owner, "LinguaLens-Phase3-analytics.png");

  await go(owner, "/lab/reports");
  await owner.getByLabel("Report title").fill("Matched attachment study demonstration");
  await owner.getByLabel("Report type").selectOption("comparison");
  await filter(owner);
  await owner.getByLabel("Experiments", { exact: true }).selectOption({ label: experiment });
  await owner.getByRole("button", { name: "Generate report", exact: true }).click();
  await owner.getByRole("heading", { name: "Matched attachment study demonstration", exact: true }).waitFor();
  for (const [format, signature] of [["PDF", "%PDF"], ["CSV", "report_id"], ["JSON", "{"]]) {
    const pending = owner.waitForEvent("download");
    await owner.getByRole("link", { name: "Download " + format }).click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    const bytes = await readFile(await download.path());
    assert.equal(bytes.subarray(0, signature.length).toString(), signature);
    if (format === "JSON") {
      const report = JSON.parse(bytes.toString());
      assert.equal(report.population, "demo");
      assert.equal(report.trials.length, 40);
      assert.equal(report.consistency.group_count, 20);
      assert.equal(report.experiments[0].protocol.datasets[0].name, dataset);
      assert.ok(report.experiments[0].protocol.datasets[0].prompt_id > 0);
    }
    if (capture) await download.saveAs(join(capture, "phase-3-demonstration." + format.toLowerCase()));
  }
  await owner.setViewportSize({ width: 390, height: 840 });
  await go(owner, "/lab/leaderboard");
  await owner.getByRole("heading", { name: "Model Leaderboard" }).waitFor();
  await filter(owner);
  await owner.getByRole("button", { name: "Calculate leaderboard" }).click();
  await owner.getByRole("heading", { name: "Comparable rankings" }).waitFor();
  assert.match(await owner.getByRole("table").first().locator("tbody tr").first().innerText(), /lingualens-reference/);
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  process.stdout.write("Passed Phase 3 browser workflow: evaluation, two blind reviews, adjudication, comparison, consistency, analytics, and three downloads.\n");
} catch (error) {
  const last = pages.find((page) => page.url().includes("/lab/evaluation") && page !== owner) ?? owner;
  await capturePage(owner, "phase-3-owner-failure.png");
  if (last !== owner) await capturePage(last, "phase-3-reviewer-failure.png");
  console.error(owner.url(), await owner.locator("main").innerText().then((text) => text.slice(0, 4500)).catch(() => ""));
  throw error;
} finally {
  await browser.close();
}
