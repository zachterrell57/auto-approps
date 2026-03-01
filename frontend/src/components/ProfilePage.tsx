import type { KnowledgeProfile } from "@/lib/types";

interface ProfilePageProps {
  knowledgeProfile: KnowledgeProfile;
  profileDirty: boolean;
  profileSaving: boolean;
  onProfileChange: (
    updates: Partial<Pick<KnowledgeProfile, "user_context" | "firm_context">>
  ) => void;
  onSaveProfile: () => void;
}

export function ProfilePage({
  knowledgeProfile,
  profileDirty,
  profileSaving,
  onProfileChange,
  onSaveProfile,
}: ProfilePageProps) {
  const profileUpdatedAt = knowledgeProfile.updated_at
    ? new Date(knowledgeProfile.updated_at).toLocaleString()
    : "Not saved yet";

  return (
    <div className="w-full max-w-xl mx-auto pt-6">
      {/* Header */}
      <div className="mb-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground leading-none">
              Knowledge Profile
            </h1>
            <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
              Reusable context about you and your firm. Do not include
              client-specific details.
            </p>
            <p className="text-xs text-foreground/30 mt-2">
              Last saved: {profileUpdatedAt}
            </p>
          </div>
          <button
            onClick={onSaveProfile}
            disabled={profileSaving || !profileDirty}
            className="shrink-0 h-10 px-5 rounded-xl bg-foreground text-background text-sm font-medium tracking-wide transition-all duration-200 hover:shadow-lg hover:shadow-foreground/10 active:scale-[0.995] disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            {profileSaving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </div>

      <div className="space-y-10">
        {/* User Knowledge */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-amber-600/10 text-amber-700">
              1
            </span>
            <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
              User Knowledge
            </span>
          </div>
          <textarea
            value={knowledgeProfile.user_context}
            onChange={(e) =>
              onProfileChange({ user_context: e.target.value })
            }
            placeholder="Reusable context about the user completing forms."
            className="w-full min-h-[160px] p-4 rounded-xl border border-foreground/10 bg-transparent text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200 resize-y"
            maxLength={20000}
          />
        </section>

        {/* Firm Knowledge */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-amber-600/10 text-amber-700">
              2
            </span>
            <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/50">
              Firm Knowledge
            </span>
          </div>
          <textarea
            value={knowledgeProfile.firm_context}
            onChange={(e) =>
              onProfileChange({ firm_context: e.target.value })
            }
            placeholder="Reusable context about the lobbying firm."
            className="w-full min-h-[160px] p-4 rounded-xl border border-foreground/10 bg-transparent text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200 resize-y"
            maxLength={20000}
          />
        </section>
      </div>
    </div>
  );
}
