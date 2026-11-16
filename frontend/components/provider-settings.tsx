"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Cable, KeyRound, Save } from "lucide-react";
import { ResearchAccess } from "@/components/research-access";
import { Button } from "@/components/ui/button";
import { Busy, MODEL_NAMES, ModelParameters, Problem, message } from "@/components/research-controls";
import { research, type Parameters, type Provider, type ProviderInfo } from "@/lib/research-api";
import { useToast } from "@/components/toast";

export function ProviderSettings() {
  return <div id="ai-model-configuration"><ResearchAccess><ProviderPanel /></ResearchAccess></div>;
}

function ProviderPanel() {
  const [providers, setProviders] = useState<ProviderInfo[]>();
  const [selection, setSelection] = useState<Provider>("openai");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    research.providers().then((value) => { if (active) { setProviders(value); setError(""); } },
      (reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [revision]);

  const provider = providers?.find((entry) => entry.provider === selection);
  return <section className="surface dashboard-panel provider-panel">
    <div className="panel-heading"><div><h2>AI Model Configuration</h2><p>Enable a provider, test its connection, and select a default model.</p></div><KeyRound size={19} /></div>
    <Problem error={error} />
    {error && <Button size="small" variant="outline" onClick={() => setRevision((value) => value + 1)}>Reload providers</Button>}
    {!providers && !error && <Busy text="Loading providers…" />}
    {providers && <label className="research-form standalone-field">AI provider<select aria-label="AI provider" value={selection} onChange={(event) => setSelection(event.target.value as Provider)}>
      {providers.map(({ provider }) => <option value={provider} key={provider}>{MODEL_NAMES[provider]}</option>)}
    </select></label>}
    {provider && <ProviderForm key={provider.provider} provider={provider} onSave={(saved) => {
      setProviders((items) => items?.map((item) => item.provider === saved.provider ? saved : item));
    }} />}
  </section>;
}

function ProviderForm({ provider, onSave }: { provider: ProviderInfo; onSave: (provider: ProviderInfo) => void }) {
  const [enabled, setEnabled] = useState(provider.enabled);
  const [model, setModel] = useState(provider.default_model ?? "");
  const [parameters, setParameters] = useState<Parameters>(provider.parameters);
  const [clear, setClear] = useState(false);
  const [models, setModels] = useState<string[]>();
  const [error, setError] = useState("");
  const [work, setWork] = useState<"saving" | "testing">();
  const toast = useToast();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const secret = (new FormData(form).get("credential") as string | null)?.trim();
    setWork("saving");
    setError("");
    try {
      onSave(await research.configure(provider.provider, {
        enabled, default_model: model.trim() || undefined, parameters,
        credential: secret || undefined, clear_credential: clear,
      }));
      const input = form.elements.namedItem("credential");
      if (input instanceof HTMLInputElement) input.value = "";
      setClear(false);
      toast("Model configuration saved");
    } catch (reason) { setError(message(reason)); }
    finally { setWork(undefined); }
  }

  async function test() {
    setWork("testing");
    setError("");
    setModels(undefined);
    try {
      const listed = await research.discover(provider.provider);
      setModels(listed);
      toast("Model catalog checked");
    } catch (reason) { setError(message(reason)); }
    finally {
      try {
        const refreshed = (await research.providers()).find((item) => item.provider === provider.provider);
        if (refreshed) onSave(refreshed);
      } catch { /* Preserve the original response and saved diagnostic if refresh fails. */ }
      setWork(undefined);
    }
  }

  return <form onSubmit={save} className="research-form">
    <fieldset disabled={!!work}><legend className="sr-only">Provider credentials and parameters</legend>
      <label className="check-field"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable {MODEL_NAMES[provider.provider]}</label>
      <div className="result-provenance"><span className={provider.configured ? "pill status-completed" : "pill status-failed"}>
        {provider.configured ? `Credential source · ${provider.credential_source}` : "Credentials needed"}
      </span><span className="pill">{provider.enabled ? "Enabled" : "Disabled"}</span></div>
      {!provider.configured && <p className="research-hint">Provider not configured. Please add valid API credentials.</p>}
      {provider.accepts_credential && provider.credential_storage && <label>API key<input type="password" name="credential" autoComplete="off" maxLength={4096}
        placeholder={provider.credential_source === "account" ? "Saved key · leave blank to keep" : "Enter a new key"} disabled={clear} /></label>}
      {provider.accepts_credential && !provider.credential_storage && <p className="research-hint">Configure the provider’s server environment variable, or set CREDENTIAL_KEY to enable encrypted account keys.</p>}
      {provider.credential_source === "account" && <label className="check-field"><input type="checkbox" checked={clear} onChange={(event) => setClear(event.target.checked)} /> Remove saved account key</label>}
      {provider.provider === "ollama" && <p className="research-hint">The server administrator configures OLLAMA_HOST. The connection test lists models available on that instance.</p>}
      <label>Default model identifier<input value={model} maxLength={200} list="available-research-models"
        placeholder={provider.provider === "ollama" ? "Model installed in Ollama" : "Select or enter a provider model ID"}
        onChange={(event) => setModel(event.target.value)} /></label>
      {models && <label>Available models<select aria-label="Available models" value={models.includes(model) ? model : ""} onChange={(event) => setModel(event.target.value)}>
        <option value="">{models.length ? "Choose from provider catalog" : "No models were returned"}</option>
        {models.map((identifier) => <option key={identifier}>{identifier}</option>)}
      </select></label>}
      <datalist id="available-research-models">{models?.map((identifier) => <option key={identifier} value={identifier} />)}</datalist>
      <details><summary>Default model parameters</summary>
        <ModelParameters provider={provider.provider} value={parameters} onChange={setParameters} />
        <p className="research-hint">Blank fields use server defaults. Leave unsupported sampling controls blank for the selected model.</p>
      </details>
    </fieldset>
    <div className="research-actions"><Button type="submit" disabled={!!work}><Save size={15} /> {work === "saving" ? "Saving…" : "Save configuration"}</Button>
      <Button variant="outline" onClick={test} disabled={!!work}><Cable size={16} /> {work === "testing" ? "Testing…" : "Test connection"}</Button></div>
    <p className="research-hint">The connection test uses the last saved configuration.</p>
    <Problem error={error} />
    <ProviderDiagnostics provider={provider} />
  </form>;
}

function ProviderDiagnostics({ provider }: { provider: ProviderInfo }) {
  const diagnostic = provider.diagnostic;
  const timestamp = (value?: string | null) => value ? new Date(value).toLocaleString() : "Unavailable";
  return <section className="provider-diagnostics" aria-label="Provider diagnostics">
    <h3>Provider diagnostics</h3>
    <p className="research-hint">The connection test checks the model catalog. A saved live trial verifies generation with the selected model.</p>
    <dl className="audit-grid">
      <div className="audit-pair"><dt>Catalog check</dt><dd>{diagnostic?.status === "reachable" ? "Reachable" : diagnostic?.status === "blocked" ? "Configuration needed" : diagnostic ? "Failed" : "Not yet checked"}</dd></div>
      <div className="audit-pair"><dt>Last successful check</dt><dd>{timestamp(diagnostic?.last_success_at)}</dd></div>
      <div className="audit-pair"><dt>Last checked</dt><dd>{timestamp(diagnostic?.checked_at)}</dd></div>
      <div className="audit-pair"><dt>Catalog latency</dt><dd>{diagnostic && diagnostic.status !== "blocked" ? `${diagnostic.latency_ms} ms` : "Unavailable"}</dd></div>
      <div className="audit-pair"><dt>Saved model ID</dt><dd>{provider.default_model ?? "Choose a model"}</dd></div>
      <div className="audit-pair"><dt>Model in sampled catalog</dt><dd>{diagnostic?.model_listed == null ? "Unavailable" : diagnostic.model_listed ? "Listed" : "Not listed in returned results"}</dd></div>
      <div className="audit-pair"><dt>Supported operations</dt><dd>{provider.capabilities.join(", ")}</dd></div>
    </dl>
    {diagnostic?.error_message && <p className="research-note">{diagnostic.error_message}</p>}
  </section>;
}
