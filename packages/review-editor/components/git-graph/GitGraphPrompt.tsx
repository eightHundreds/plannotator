import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@plannotator/ui/components/ui/dialog";

export type GitGraphPromptField =
  | { id: string; type: "text" | "number"; label: string; defaultValue?: string; placeholder?: string; autofocus?: boolean }
  | { id: string; type: "checkbox"; label: string; defaultValue?: boolean }
  | { id: string; type: "radio"; name: string; options: { value: string; label: string }[]; defaultValue?: string }
  | { id: string; type: "select"; label: string; options: { value: string; label: string }[]; defaultValue?: string; emptyLabel?: string }
  | { id: string; type: "note"; text: string };

export type GitGraphPromptSpec = {
  title: string;
  fields: GitGraphPromptField[];
  confirmText?: string;
  variant?: "info" | "warning";
  onConfirm: (values: Record<string, string | boolean>) => Promise<void> | void;
};

const fieldClass =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50";

function collectDefaults(fields: GitGraphPromptField[]): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const field of fields) {
    if (field.type === "checkbox") values[field.id] = Boolean(field.defaultValue);
    else if (field.type === "radio") values[field.name] = field.defaultValue ?? field.options[0]?.value ?? "";
    else if (field.type === "select") values[field.id] = field.defaultValue ?? "";
    else if (field.type === "text" || field.type === "number") values[field.id] = field.defaultValue ?? "";
  }
  return values;
}

export const GitGraphPrompt: React.FC<{
  spec: GitGraphPromptSpec | null;
  onClose: () => void;
}> = ({ spec, onClose }) => {
  const descriptionId = useId();
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaults = useMemo(() => (spec ? collectDefaults(spec.fields) : {}), [spec]);
  useEffect(() => {
    setValues(defaults);
    setBusy(false);
    setError(null);
  }, [defaults]);

  if (!spec) return null;

  const variant = spec.variant ?? "info";
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await spec.onConfirm(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        hideClose
        aria-describedby={descriptionId}
        initialFocus={() => firstFieldRef.current}
        backdropClassName="bg-background/80 backdrop-blur-sm"
        className="bg-card text-foreground rounded-xl shadow-2xl p-6 transition-none max-w-sm"
        data-plannotator-confirm-dialog="true"
      >
        <DialogTitle className="font-semibold tracking-normal mb-3">{spec.title}</DialogTitle>
        <div id={descriptionId} className="space-y-2.5">
          {spec.fields.map((field, index) => {
            if (field.type === "note") {
              return (
                <p key={field.id} className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                  {field.text}
                </p>
              );
            }
            if (field.type === "checkbox") {
              return (
                <label key={field.id} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.id])}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.checked }))}
                    className="rounded border-border"
                  />
                  {field.label}
                </label>
              );
            }
            if (field.type === "radio") {
              return (
                <div key={field.id} className="space-y-1.5">
                  {field.options.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="radio"
                        name={field.name}
                        value={opt.value}
                        checked={values[field.name] === opt.value}
                        onChange={() => setValues((prev) => ({ ...prev, [field.name]: opt.value }))}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              );
            }
            if (field.type === "select") {
              return (
                <label key={field.id} className="block text-sm text-muted-foreground">
                  <span className="mb-1 block">{field.label}</span>
                  <select
                    ref={index === 0 ? (firstFieldRef as React.Ref<HTMLSelectElement>) : undefined}
                    className={fieldClass}
                    value={String(values[field.id] ?? "")}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  >
                    {field.emptyLabel != null && <option value="">{field.emptyLabel}</option>}
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            return (
              <label key={field.id} className="block text-sm text-muted-foreground">
                <span className="mb-1 block">{field.label}</span>
                <input
                  ref={field.autofocus || index === 0 ? (firstFieldRef as React.Ref<HTMLInputElement>) : undefined}
                  type={field.type}
                  className={fieldClass}
                  placeholder={field.placeholder}
                  value={String(values[field.id] ?? "")}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void confirm();
                    }
                  }}
                />
              </label>
            );
          })}
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            data-pn-touch-target="true"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-md text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-opacity disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-pn-touch-target="true"
            onClick={() => void confirm()}
            disabled={busy}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-opacity disabled:opacity-50 ${
              variant === "warning"
                ? "bg-warning text-warning-foreground"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {busy ? "Working…" : spec.confirmText ?? "OK"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
