import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { api, type AssetsReport, type RuleAsset, type SkillAsset, type SubagentAsset } from '../lib/api';
import { Section, Spinner, cls } from '../components/common';

type Scope = 'project' | 'global';
type AddKind = 'rule' | 'skill' | 'subagent' | null;

export function AssetsPage({ project }: { project: string | null }): React.ReactElement {
  const [data, setData] = useState<AssetsReport | null>(null);
  const [scope, setScope] = useState<Scope>(project ? 'project' : 'global');
  const [adding, setAdding] = useState<AddKind>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.assets(project ?? undefined).then(setData).catch(() => {});
  }, [project]);
  useEffect(() => load(), [load]);

  if (!data) return <Spinner />;

  const wrap = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      setAdding(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const delRule = (r: RuleAsset): Promise<void> => wrap(() => api.deleteRule(project ?? undefined, r.scope as Scope, r.id));
  const delSkill = (s: SkillAsset): Promise<void> => wrap(() => api.deleteSkill(project ?? undefined, s.scope as Scope, s.slug));
  const delSubagent = (s: SubagentAsset): Promise<void> => wrap(() => api.deleteSubagent(project ?? undefined, s.scope as Scope, s.slug));

  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-sm text-muted">
        Rules, skills, and subagents are injected into prompts and per-subtask routing. Project scope overrides global. New
        items are created in the selected scope; files live under <code className="text-text">{data.roots.project}</code> and{' '}
        <code className="text-text">{data.roots.global}</code>.
      </p>

      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-muted">Create in</span>
        <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          <button
            onClick={() => setScope('project')}
            disabled={!project}
            className={cls('px-2.5 py-1.5 transition-colors disabled:opacity-40', scope === 'project' ? 'bg-accent/20 text-text' : 'text-muted hover:text-text')}
          >
            Project
          </button>
          <button
            onClick={() => setScope('global')}
            className={cls('px-2.5 py-1.5 transition-colors', scope === 'global' ? 'bg-accent/20 text-text' : 'text-muted hover:text-text')}
          >
            Global
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}

      <AssetSection
        title="Rules"
        count={data.rules.length}
        onAdd={() => setAdding(adding === 'rule' ? null : 'rule')}
        adding={adding === 'rule'}
        form={<RuleForm onSubmit={(b) => wrap(() => api.createRule({ cwd: project ?? undefined, scope, ...b }))} onCancel={() => setAdding(null)} />}
      >
        {data.rules.map((r) => (
          <AssetRow key={`${r.scope}:${r.id}`} name={r.id} description={r.description} scope={r.scope} onDelete={() => delRule(r)} />
        ))}
      </AssetSection>

      <AssetSection
        title="Skills"
        count={data.skills.length}
        onAdd={() => setAdding(adding === 'skill' ? null : 'skill')}
        adding={adding === 'skill'}
        form={<SkillForm onSubmit={(b) => wrap(() => api.createSkill({ cwd: project ?? undefined, scope, ...b }))} onCancel={() => setAdding(null)} />}
      >
        {data.skills.map((s) => (
          <AssetRow key={`${s.scope}:${s.slug}`} name={s.name} description={s.description} scope={s.scope} onDelete={() => delSkill(s)} />
        ))}
      </AssetSection>

      <AssetSection
        title="Subagents"
        count={data.subagents.length}
        onAdd={() => setAdding(adding === 'subagent' ? null : 'subagent')}
        adding={adding === 'subagent'}
        form={<SubagentForm onSubmit={(b) => wrap(() => api.createSubagent({ cwd: project ?? undefined, scope, ...b }))} onCancel={() => setAdding(null)} />}
      >
        {data.subagents.map((s) => (
          <AssetRow
            key={`${s.scope}:${s.slug}`}
            name={s.name}
            description={s.description || [s.kind, s.model].filter(Boolean).join(' · ')}
            scope={s.scope}
            onDelete={() => delSubagent(s)}
          />
        ))}
      </AssetSection>
    </div>
  );
}

function AssetSection({
  title,
  count,
  onAdd,
  adding,
  form,
  children,
}: {
  title: string;
  count: number;
  onAdd: () => void;
  adding: boolean;
  form: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Section
      title={`${title} (${count})`}
      right={
        <button onClick={onAdd} className="btn">
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {adding ? 'Cancel' : `Add ${title.replace(/s$/, '').toLowerCase()}`}
        </button>
      }
    >
      {adding && <div className="card mb-3">{form}</div>}
      <div className="space-y-2">{children}</div>
    </Section>
  );
}

function AssetRow({
  name,
  description,
  scope,
  onDelete,
}: {
  name: string;
  description?: string;
  scope: string;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <div className="card flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        {description && <div className="truncate text-sm text-muted">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cls('chip', scope === 'project' ? 'border-accent text-accent' : '')}>{scope}</span>
        <button onClick={onDelete} className="btn btn-danger px-2" title="Delete">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function RuleForm({ onSubmit, onCancel }: { onSubmit: (b: { id: string; description?: string; globs?: string[]; alwaysApply?: boolean; body: string }) => void; onCancel: () => void }): React.ReactElement {
  const [id, setId] = useState('');
  const [description, setDescription] = useState('');
  const [globs, setGlobs] = useState('');
  const [alwaysApply, setAlwaysApply] = useState(false);
  const [body, setBody] = useState('');
  return (
    <div className="space-y-3">
      <Field label="Name / id">
        <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. prefer-named-exports" />
      </Field>
      <Field label="Description">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When this rule applies" />
      </Field>
      <Field label="Globs (comma-separated, optional)">
        <input className="input" value={globs} onChange={(e) => setGlobs(e.target.value)} placeholder="src/**/*.ts, *.tsx" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={alwaysApply} onChange={(e) => setAlwaysApply(e.target.checked)} />
        Always apply
      </label>
      <Field label="Rule body">
        <textarea className="input min-h-[120px] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown instructions for the model…" />
      </Field>
      <FormActions
        disabled={!id.trim() || !body.trim()}
        onCancel={onCancel}
        onSubmit={() => onSubmit({ id: id.trim(), description: description.trim() || undefined, globs: globs.split(',').map((g) => g.trim()).filter(Boolean), alwaysApply, body })}
      />
    </div>
  );
}

function SkillForm({ onSubmit, onCancel }: { onSubmit: (b: { name: string; description?: string; body: string }) => void; onCancel: () => void }): React.ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  return (
    <div className="space-y-3">
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Write release notes" />
      </Field>
      <Field label="Description">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this skill does / when to use it" />
      </Field>
      <Field label="Skill body">
        <textarea className="input min-h-[120px] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown instructions…" />
      </Field>
      <FormActions disabled={!name.trim() || !body.trim()} onCancel={onCancel} onSubmit={() => onSubmit({ name: name.trim(), description: description.trim() || undefined, body })} />
    </div>
  );
}

const EFFORTS = ['', 'low', 'medium', 'high', 'max'];

function SubagentForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (b: { name: string; description?: string; kind?: string; provider?: string; model?: string; effort?: string; body: string }) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [body, setBody] = useState('');
  return (
    <div className="space-y-3">
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Test writer" />
      </Field>
      <Field label="Description">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this subagent specializes in" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind (optional)">
          <input className="input" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="frontend, tests…" />
        </Field>
        <Field label="Effort (optional)">
          <select className="input" value={effort} onChange={(e) => setEffort(e.target.value)}>
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e || 'default'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Provider (optional)">
          <input className="input" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="openrouter" />
        </Field>
        <Field label="Model (optional)">
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="anthropic/claude-…" />
        </Field>
      </div>
      <Field label="Subagent body">
        <textarea className="input min-h-[120px] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown system prompt…" />
      </Field>
      <FormActions
        disabled={!name.trim() || !body.trim()}
        onCancel={onCancel}
        onSubmit={() =>
          onSubmit({
            name: name.trim(),
            description: description.trim() || undefined,
            kind: kind.trim() || undefined,
            provider: provider.trim() || undefined,
            model: model.trim() || undefined,
            effort: effort || undefined,
            body,
          })
        }
      />
    </div>
  );
}

function FormActions({ disabled, onSubmit, onCancel }: { disabled: boolean; onSubmit: () => void; onCancel: () => void }): React.ReactElement {
  return (
    <div className="flex justify-end gap-2">
      <button onClick={onCancel} className="btn">
        Cancel
      </button>
      <button onClick={onSubmit} disabled={disabled} className="btn btn-primary">
        Create
      </button>
    </div>
  );
}
