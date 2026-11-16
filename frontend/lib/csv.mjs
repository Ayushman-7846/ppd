export function demoCsv(demo) {
  const cell = (value) => '"' + String(value).replaceAll('"', '""') + '"';
  const header = ["provenance", "dimension", ...demo.models];
  const rows = demo.scores.map((row) => [demo.provenance, row.dimension, ...demo.models.map((name) => row[name])]);
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
