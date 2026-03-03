import { useState, useCallback, useRef, useEffect } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, Save, Check } from "lucide-react";
import type { Client, ClientCreate, ClientUpdate } from "@/lib/types";

interface ClientsPageProps {
  clients: Client[];
  onCreateClient: (data: ClientCreate) => Promise<Client>;
  onUpdateClient: (id: string, data: ClientUpdate) => Promise<Client>;
  onDeleteClient: (id: string) => Promise<void>;
}

function timeDisplay(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function ClientRow({
  client,
  onUpdate,
  onDelete,
}: {
  client: Client;
  onUpdate: (id: string, data: ClientUpdate) => Promise<Client>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(client.name);
  const [knowledge, setKnowledge] = useState(client.knowledge);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const dirty = name !== client.name || knowledge !== client.knowledge;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    try {
      const updated = await onUpdate(client.id, { name, knowledge });
      setName(updated.name);
      setKnowledge(updated.knowledge);
      setSaved(true);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [client.id, name, knowledge, onUpdate]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await onDelete(client.id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [client.id, onDelete]);

  return (
    <div className="border border-foreground/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-foreground/[0.02] transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-foreground/30 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-foreground/30 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {client.name}
          </p>
          <p className="text-xs text-foreground/30 mt-0.5">
            Updated {timeDisplay(client.updated_at)}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-foreground/5">
          <div className="pt-4">
            <label className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50 block mb-2">
              Client Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-transparent text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200"
              maxLength={255}
            />
          </div>

          <div>
            <label className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50 block mb-2">
              Knowledge
            </label>
            <textarea
              value={knowledge}
              onChange={(e) => setKnowledge(e.target.value)}
              placeholder="Client-specific context the AI can reference during form filling..."
              className="w-full min-h-[160px] p-4 rounded-xl border border-foreground/10 bg-transparent text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200 resize-y"
              maxLength={20000}
            />
            <p className="text-xs text-foreground/20 mt-1 text-right">
              {knowledge.length.toLocaleString()} / 20,000
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-600">Delete this client?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs font-medium text-rose-600 hover:text-rose-700 transition-colors"
                >
                  {deleting ? "Deleting..." : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs font-medium text-foreground/40 hover:text-foreground/60 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-xs text-foreground/30 hover:text-rose-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={saving || (!dirty && !saved) || !name.trim()}
              className={`flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed ${
                saved
                  ? "bg-emerald-600 text-white"
                  : "bg-foreground text-background hover:shadow-md disabled:opacity-20"
              }`}
            >
              {saved ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Saved
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  {saving ? "Saving..." : "Save"}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ClientsPage({
  clients,
  onCreateClient,
  onUpdateClient,
  onDeleteClient,
}: ClientsPageProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await onCreateClient({ name: newName.trim() });
      setNewName("");
      setCreating(false);
    } finally {
      setSaving(false);
    }
  }, [newName, onCreateClient]);

  return (
    <div className="w-full max-w-xl mx-auto pt-6">
      {/* Header */}
      <div className="mb-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground leading-none">
              Clients
            </h1>
            <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
              Manage per-client knowledge that the AI can reference during form
              filling.
            </p>
          </div>
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              className="shrink-0 flex items-center gap-2 h-10 px-5 rounded-xl bg-foreground text-background text-sm font-medium tracking-wide transition-all duration-200 hover:shadow-lg hover:shadow-foreground/10 active:scale-[0.995]"
            >
              <Plus className="w-4 h-4" />
              New Client
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Inline create form */}
        {creating && (
          <div className="border border-amber-300/50 rounded-xl p-5 space-y-3 bg-amber-50/20">
            <label className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50 block">
              New Client Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter client name..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-white text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200"
              maxLength={255}
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                className="h-9 px-4 rounded-lg bg-foreground text-background text-sm font-medium transition-all duration-200 hover:shadow-md disabled:opacity-20 disabled:cursor-not-allowed"
              >
                {saving ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="h-9 px-4 rounded-lg text-sm font-medium text-foreground/40 hover:text-foreground/60 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Client list */}
        {clients.length === 0 && !creating && (
          <p className="text-sm text-foreground/30 py-8 text-center">
            No clients yet. Create one to store per-client context.
          </p>
        )}
        {clients.map((client) => (
          <ClientRow
            key={client.id}
            client={client}
            onUpdate={onUpdateClient}
            onDelete={onDeleteClient}
          />
        ))}
      </div>
    </div>
  );
}
