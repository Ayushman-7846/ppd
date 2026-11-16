"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PhoneRow } from "@/lib/research-api";

export const cleanPhone = (row: PhoneRow): PhoneRow => ({
  word_id: row.word_id, surface: row.surface, underlying: row.underlying?.trim() || undefined,
  target: row.target?.trim() || undefined, context: row.context?.trim() || undefined,
});

export function PhoneInput({ rows, setRows, phones, setPhones, disabled }:
  { rows: PhoneRow[]; setRows: (rows: PhoneRow[]) => void; phones: string; setPhones: (text: string) => void; disabled: boolean }) {
  function field(index: number, key: keyof PhoneRow, value: string) {
    setRows(rows.map((row, position) => position === index ? { ...row, [key]: value } : row));
  }
  function add() {
    const existing = new Set(rows.map((row) => row.word_id));
    let ordinal = rows.length + 1;
    while (existing.has("w" + ordinal)) ordinal++;
    setRows([...rows, { word_id: "w" + ordinal, surface: "" }]);
  }
  return <fieldset className="phone-input" disabled={disabled}>
    <legend>Phonological examples</legend>
    <p className="research-hint">Enter phones separated by spaces. IPA is supported. Underlying forms are optional for rule discovery.</p>
    <label>Phones of interest<input value={phones} onChange={(event) => setPhones(event.target.value)} placeholder="b p" maxLength={500} /></label>
    <div className="phone-input-list">{rows.map((row, index) => <div className="phone-input-row" key={index}>
      <label>Word ID<input value={row.word_id} onChange={(event) => field(index, "word_id", event.target.value)} required maxLength={64} /></label>
      <label>Underlying<input value={row.underlying ?? ""} onChange={(event) => field(index, "underlying", event.target.value)} maxLength={1800} /></label>
      <label>Surface<input value={row.surface} onChange={(event) => field(index, "surface", event.target.value)} required maxLength={1800} /></label>
      <details><summary>Target and context</summary>
        <label>Target phoneme<input value={row.target ?? ""} onChange={(event) => field(index, "target", event.target.value)} maxLength={24} /></label>
        <label>Context<input value={row.context ?? ""} onChange={(event) => field(index, "context", event.target.value)} maxLength={240} /></label>
      </details>
      <Button variant="ghost" size="icon" aria-label={`Remove phonological row ${index + 1}`} disabled={rows.length === 1}
        onClick={() => setRows(rows.filter((_, position) => position !== index))}><Trash2 size={15} /></Button>
    </div>)}</div>
    <Button size="small" variant="outline" onClick={add} disabled={rows.length >= 60}><Plus size={14} /> Add row</Button>
  </fieldset>;
}
