import { useState } from "react";
import { useKnowledgeProfile } from "@/hooks/useKnowledgeProfile";
import { useFormFiller } from "@/hooks/useFormFiller";
import { UploadStep } from "@/components/UploadStep";
import { AnswerSheetStep } from "@/components/AnswerSheetStep";
import { SettingsPage } from "@/components/SettingsPage";
import { ProfilePage } from "@/components/ProfilePage";
import { cn } from "@/lib/utils";

type Page = "main" | "profile" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("main");
  const profile = useKnowledgeProfile();
  const formFiller = useFormFiller();

  const error = formFiller.error || profile.profileError;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white">
        <div className="max-w-2xl mx-auto px-4 flex items-center gap-6 h-14">
          <span className="font-semibold text-lg">AutoApprops</span>
          <button
            onClick={() => setPage("main")}
            className={cn(
              "text-sm h-full border-b-2 transition-colors",
              page === "main"
                ? "border-gray-900 text-gray-900 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            Form Filler
          </button>
          <button
            onClick={() => setPage("profile")}
            className={cn(
              "text-sm h-full border-b-2 transition-colors",
              page === "profile"
                ? "border-gray-900 text-gray-900 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            Profile
          </button>
          <button
            onClick={() => setPage("settings")}
            className={cn(
              "text-sm h-full border-b-2 transition-colors",
              page === "settings"
                ? "border-gray-900 text-gray-900 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            Settings
          </button>
        </div>
      </nav>

      <div className="py-8 px-4">
        {error && (
          <div className="max-w-2xl mx-auto mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </div>
        )}

        {page === "settings" && (
          <SettingsPage
            settings={formFiller.appSettings}
            saving={formFiller.settingsSaving}
            onSave={formFiller.saveAppSettings}
          />
        )}

        {page === "profile" && (
          <ProfilePage
            knowledgeProfile={profile.knowledgeProfile}
            profileDirty={profile.profileDirty}
            profileSaving={profile.profileSaving}
            onProfileChange={profile.updateKnowledgeProfile}
            onSaveProfile={profile.saveKnowledgeProfile}
          />
        )}

        {page === "main" && formFiller.step === "upload" && (
          <UploadStep
            loading={formFiller.loading}
            onProcess={formFiller.process}
            onLoadDebug={formFiller.loadDebugData}
          />
        )}

        {page === "main" && formFiller.step === "answers" && formFiller.formSchema && (
          <AnswerSheetStep
            formSchema={formFiller.formSchema}
            mappings={formFiller.mappings}
            unmappedFields={formFiller.mappingResult?.unmapped_fields ?? []}
            loading={formFiller.loading}
            debugDocBlobUrl={formFiller.debugDocBlobUrl}
            onUpdate={formFiller.updateMapping}
            onRemap={formFiller.remap}
            onReset={formFiller.reset}
          />
        )}
      </div>
    </div>
  );
}
