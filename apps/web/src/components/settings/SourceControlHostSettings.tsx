import type { EnvironmentId } from "@t3tools/contracts";
import type { SourceControlDefinition } from "@t3tools/client-runtime/source-control-clients";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { ProviderSettingsForm } from "./ProviderSettingsForm";

export function SourceControlHostSettings({
  environmentId,
  definition,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly definition: SourceControlDefinition & {
    readonly settings: NonNullable<SourceControlDefinition["settings"]>;
  };
  readonly onSaved: () => void;
}) {
  const saved = useEnvironmentSettings(
    environmentId,
    (settings) => settings.sourceControlHosts[definition.kind],
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: `save ${definition.label} settings`,
  });
  const [saving, setSaving] = useState(false);
  const formDefinition = { settingsSchema: definition.settings };
  // The host's own fields, and only those. Its blob also carries the `enabled` switch the row
  // above owns, and this form must neither count it as saved nor clear it.
  const formFields = Object.keys(definition.settings.fields);
  const hasSaved = formFields.some((field) => (saved?.[field] ?? "") !== "");

  const save = async (fields: Record<string, unknown>) => {
    setSaving(true);
    const result = await updateSettings({
      environmentId,
      input: { patch: { sourceControlHosts: { [definition.kind]: fields } } },
    });
    setSaving(false);
    if (result._tag === "Success") onSaved();
  };

  return (
    // Locked while saving, so an edit made mid-request is not overwritten by the saved value.
    <fieldset disabled={saving} className="contents">
      <ProviderSettingsForm
        definition={formDefinition}
        value={saved ?? {}}
        idPrefix={`source-control-${definition.kind}-${environmentId}`}
        variant="settings"
        onChange={(next) => {
          const fields = next ?? {};
          const changed = Object.fromEntries(
            Object.entries(fields).filter(([key, value]) => saved?.[key] !== value),
          );
          const cleared = formFields.filter((key) => !(key in fields));
          void save({ ...changed, ...Object.fromEntries(cleared.map((key) => [key, ""])) });
        }}
      />
      {hasSaved ? (
        <div className="flex justify-end pt-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => void save(Object.fromEntries(formFields.map((field) => [field, ""])))}
          >
            Remove
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
