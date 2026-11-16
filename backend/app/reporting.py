import csv
import io
from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, TableStyle

from .csv_cells import spreadsheet_safe


NAVY = colors.HexColor("#101d35")
ACCENT = colors.HexColor("#315cdf")
CYAN = colors.HexColor("#137d91")
MUTED = colors.HexColor("#425374")
PALE = colors.HexColor("#eef3fc")
RULE = colors.HexColor("#d9e2f2")
AVAILABLE_WIDTH = A4[0] - 96
LABELS = {"experiment": "Individual Experiment Report", "comparison": "Multi-Model Comparison Report",
          "task": "Linguistic Task Analysis Report", "consistency": "Consistency Analysis Report", "evaluation": "Evaluation Summary Report"}


@lru_cache
def report_fonts():
    candidates = (
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    )
    for regular, bold in candidates:
        if Path(regular).is_file() and Path(bold).is_file():
            pdfmetrics.registerFont(TTFont("LinguaSans", regular))
            pdfmetrics.registerFont(TTFont("LinguaSansBold", bold))
            return "LinguaSans", "LinguaSansBold"
    return "Helvetica", "Helvetica-Bold"


def value(number, suffix=""):
    return "Unavailable" if number is None else f"{number:.2f}{suffix}"


def csv_report(report):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["report_id", "population", "method", "rubric_version", "response_id", "experiment_id", "dataset", "dataset_version",
                     "task", "provider", "model", "trial", "status", "score", "verdict",
                     "latency_ms", "input_tokens", "output_tokens", "error_categories"])
    for row in report["trials"]:
        writer.writerow(map(spreadsheet_safe, [
            report["id"], report["population"], report["method"], report["rubric"]["version"], row["id"], row["experiment_id"],
            row["dataset"], row["dataset_version"], row["dimension"], row["provider"], row["model"], row["trial"], row["state"],
            row["score"], row["verdict"], row["latency_ms"], row["input_tokens"], row["output_tokens"],
            ", ".join(row["errors"]),
        ]))
    return output.getvalue()


def pdf_report(report):
    output = io.BytesIO()
    title = LABELS[report["type"]]
    normal_font, bold_font = report_fonts()
    body = ParagraphStyle("LL-body", fontName=normal_font, fontSize=10.5, leading=14, textColor=NAVY, spaceAfter=8)
    tiny = ParagraphStyle("LL-small", parent=body, fontSize=8.3, leading=12, spaceAfter=0, textColor=MUTED)
    head_cell = ParagraphStyle("LL-table-head", parent=tiny, fontName=bold_font, textColor=colors.white)
    small_bold = ParagraphStyle("LL-label", parent=tiny, fontName=bold_font, textColor=CYAN, spaceAfter=12)
    heading = ParagraphStyle("LL-heading", parent=body, fontName=bold_font, fontSize=15, leading=19,
                             spaceBefore=11, spaceAfter=7, keepWithNext=True)
    cover = ParagraphStyle("LL-cover", parent=heading, fontSize=32, leading=36, spaceAfter=18, alignment=TA_LEFT)
    flow = []

    def paragraph(text, style=body):
        return Paragraph(escape(str(text)).replace("\n", "<br/>"), style)

    def section(label, text=None):
        flow.append(paragraph(label, heading))
        if text is not None:
            flow.append(paragraph(text))

    def table(headers, rows, fractions):
        cells = [[paragraph(label, head_cell) for label in headers]]
        cells.extend([paragraph(cell if cell not in ("", None) else "Unavailable", tiny) for cell in row] for row in rows)
        result = LongTable(cells, colWidths=[AVAILABLE_WIDTH * fraction for fraction in fractions], repeatRows=1, hAlign="LEFT")
        result.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
            ("LINEBELOW", (0, 0), (-1, 0), 1, ACCENT),
            ("LINEBELOW", (0, 1), (-1, -1), .3, RULE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        flow.append(result)
        flow.append(Spacer(1, 12))

    def footer(canvas, doc):
        width, height = A4
        canvas.setFillColor(NAVY)
        canvas.rect(0, height - 36, width, 36, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont(bold_font, 9)
        canvas.drawString(48, height - 23, "LINGUALENS   /   METALINGUISTIC RESEARCH")
        canvas.setStrokeColor(RULE)
        canvas.line(48, 44, width - 48, 44)
        canvas.setFont(normal_font, 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(48, 30, f"Research record LL-{report['id']}")
        canvas.drawRightString(width - 48, 30, f"Page {doc.page}")

    demo = report["population"] == "demo"
    metrics = report["analytics"]["metrics"]
    scope = report["experiments"]
    models = report["analytics"]["comparison"]["models"]
    model_names = {entry["id"]: f"{entry['provider']} / {entry['model']}" for entry in models}
    tasks = ", ".join(sorted({row["dimension"].replace("_", " ") for row in report["trials"]}))
    flow.extend([Spacer(1, 52), paragraph("LINGUALENS RESEARCH SERIES", small_bold), paragraph(title, cover),
                 paragraph("Curated demonstration data" if demo else "Recorded experiment data", heading),
                 paragraph(report["title"]), Spacer(1, 10)])
    table(["Report ID", "Researcher", "Generated (UTC)"], [[f"LL-{report['id']}", report["researcher"], report["generated_at"]]], [.22, .44, .34])
    section("Experiments", ", ".join(row["name"] for row in scope))
    section("Executive summary", f"{metrics['settled']} settled trials across {report['analytics']['model_count']} model profiles. "
            f"{metrics['weighted_scores']} trials have a complete weighted score. "
            f"Mean stimulus score: {value(metrics['score']['mean'])}. Correct among decisive verdicts: {value(metrics['correctness_rate'], '%')}. "
            f"Decisive verdicts: {metrics['decisive']}.")
    section("Objectives", f"Linguistic tasks in the filtered cohort: {tasks or 'none'}. "
            "Summarize results under the selected rubric, including available evidence, missing observations, and repeatability.")
    flow.append(PageBreak())

    section("Experimental methodology",
            f"Evaluation method: {report['method']}. Rubric: {report['rubric']['name']} v{report['rubric']['version']}. "
            "Scores are weighted only when every nonzero criterion can be graded. The protocol tables describe the full selected experiments. "
            "Results use only the report's selected source and cohort filters.")
    table(["Criterion", "Weight"], [[name.replace("_", " "), f"{weight:g}%"] for name, weight in report["rubric"]["weights"].items()], [.73, .27])
    table(["Dataset / version", "Dimension", "Prompt version", "Items / trials"], [
        [f"{dataset.get('name', 'Dataset')} / v{dataset.get('version', '?')}", dataset.get("dimension"), dataset.get("prompt_version"),
         f"{dataset.get('item_count', '?')} items / {run['repetitions']} repeats"]
        for run in scope for dataset in run.get("protocol", {}).get("datasets", [])
    ], [.42, .20, .17, .21])
    parameter_rows = [
        [model.get("provider"), model.get("model"), ", ".join(f"{key}={val}" for key, val in model.get("parameters", {}).items())
         or "No explicit overrides"]
        for run in scope for model in run.get("protocol", {}).get("models", [])
    ]
    if parameter_rows:
        table(["Provider", "Model ID", "Recorded parameters"], parameter_rows, [.17, .34, .49])

    section("Results")
    table(["Model", "Scored trials", "Mean score", "Decisive % correct", "Failed"],
          [[entry["model"], entry["metrics"]["weighted_scores"], value(entry["metrics"]["score"]["mean"]),
            value(entry["metrics"]["correctness_rate"], "%"), entry["metrics"]["failed"]] for entry in models],
          [.40, .16, .15, .17, .12])
    plot_models = [entry for entry in models if entry["metrics"]["score"]["mean"] is not None][:10]
    if plot_models:
        chart = Drawing(AVAILABLE_WIDTH, len(plot_models) * 24 + 24)
        for index, entry in enumerate(plot_models):
            ordinate = (len(plot_models) - index - 1) * 24 + 16
            score = entry["metrics"]["score"]["mean"]
            chart.add(String(0, ordinate + 3, entry["model"][:29], fontName=normal_font, fontSize=8, fillColor=NAVY))
            chart.add(Rect(155, ordinate, 260, 12, fillColor=PALE, strokeColor=None))
            chart.add(Rect(155, ordinate, 260 * score / 100, 12, fillColor=ACCENT, strokeColor=None))
            chart.add(String(425, ordinate + 2, f"{score:.1f}", fontName=normal_font, fontSize=8, fillColor=NAVY))
        flow.append(KeepTogether([paragraph("Mean stimulus scores, 0-100", tiny), chart]))
    if report["analytics"]["comparison"]["warning"]:
        flow.append(paragraph(report["analytics"]["comparison"]["warning"]))
    task_stats = [
        [entry["model"], task, cell["weighted_scores"], value(cell["score"]["mean"]), value(cell["correctness_rate"], "%")]
        for entry in models for task, cell in entry["tasks"].items() if cell["responses"]
    ]
    if task_stats:
        table(["Model", "Task", "Scored trials", "Mean score", "Decisive % correct"], task_stats, [.33, .20, .15, .15, .17])

    section("Error analysis")
    if metrics["errors"]:
        table(["Error category", "Affected responses"], [[name.replace("_", " "), count]
              for name, count in sorted(metrics["errors"].items(), key=lambda pair: -pair[1])], [.72, .28])
    else:
        flow.append(paragraph("The selected records have no retained error annotations."))
    section("Consistency analysis", f"{report['consistency']['group_count']} comparable repeated-trial groups.")
    table(["Agreement measure", "Mean across eligible groups"],
          [[label, value(report["consistency"]["summary"].get(key), "%")] for key, label in [
              ("classification", "Classification"), ("verdict", "Decisive verdict"), ("structure", "Structural"), ("exact", "Exact output")]], [.55, .45])
    section("Statistical analysis")
    stat = metrics["score"]
    interval = stat["confidence_interval"]
    text = f"Independent stimulus values: {stat['n']}. Median: {value(stat['median'])}. Sample SD: {value(stat['sample_sd'])}. Sample variance: {value(stat['sample_variance'])}. "
    text += (f"95% percentile bootstrap interval: {interval[0]:.2f} to {interval[1]:.2f}." if interval
             else "Insufficient data for reliable statistical analysis.")
    flow.append(paragraph(text))
    if report["analytics"]["comparison"]["paired"]:
        table(["Model pair", "Matched stimuli", "Mean paired difference", "95% interval"], [
            [f"{model_names.get(row['first'], row['first'])} vs {model_names.get(row['second'], row['second'])}",
             row["difference"]["n"], value(row["difference"]["mean"]),
             " to ".join(f"{bound:.2f}" for bound in row["difference"]["confidence_interval"]) if row["difference"]["confidence_interval"] else "Unavailable"]
            for row in report["analytics"]["comparison"]["paired"]
        ], [.28, .20, .29, .23])
    section("Discussion", "Stimulus means collapse repeated trials before interval estimation. Missing scores and uncertain verdicts are omitted from their respective denominators. "
            + ("This report demonstrates the workflow using authored example outputs." if demo else
               "The findings concern the recorded model and dataset versions. Provider outputs can vary in future runs."))
    section("Conclusion", "Interpret the results in the context of the rubric, eligible observations, and matched protocols. The CSV and JSON exports retain response-level details.")
    section("References", "Beguš, G., Dąbkowski, M., & Rhodes, R. (2025). Large Linguistic Models: Investigating LLMs' Metalinguistic Abilities. IEEE Transactions on Artificial Intelligence. DOI 10.1109/TAI.2025.3575745.")
    doc = SimpleDocTemplate(output, pagesize=A4, leftMargin=48, rightMargin=48, topMargin=58, bottomMargin=58,
                            title=title, author="LinguaLens", subject=report["title"])
    doc.build(flow, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
