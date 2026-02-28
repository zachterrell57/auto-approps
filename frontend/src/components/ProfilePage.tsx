import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Knowledge Profile</CardTitle>
            <CardDescription>
              Reusable context about you and your firm. Do not include
              client-specific details.
            </CardDescription>
            <p className="text-xs text-muted-foreground mt-2">
              Last saved: {profileUpdatedAt}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onSaveProfile}
            disabled={profileSaving || !profileDirty}
          >
            {profileSaving ? "Saving..." : "Save Profile"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">User Knowledge</label>
          <Textarea
            value={knowledgeProfile.user_context}
            onChange={(e) => onProfileChange({ user_context: e.target.value })}
            placeholder="Reusable context about the user completing forms."
            className="min-h-32"
            maxLength={20000}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Firm Knowledge</label>
          <Textarea
            value={knowledgeProfile.firm_context}
            onChange={(e) => onProfileChange({ firm_context: e.target.value })}
            placeholder="Reusable context about the lobbying firm."
            className="min-h-32"
            maxLength={20000}
          />
        </div>
      </CardContent>
    </Card>
  );
}
