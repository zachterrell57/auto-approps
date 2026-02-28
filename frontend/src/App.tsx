import { useFormFiller } from "@/hooks/useFormFiller";
import { UploadStep } from "@/components/UploadStep";
import { AnswerSheetStep } from "@/components/AnswerSheetStep";
import { SettingsPanel } from "@/components/SettingsPanel";

export default function App() {
  const {
    step,
    loading,
    profileSaving,
    settingsSaving,
    error,
    formSchema,
    mappings,
    mappingResult,
    knowledgeProfile,
    profileDirty,
    useProfileContext,
    appSettings,
    process,
    remap,
    updateMapping,
    updateKnowledgeProfile,
    saveKnowledgeProfile,
    saveAppSettings,
    setUseProfileContext,
    reset,
  } = useFormFiller();

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto mb-4 flex justify-end">
        <SettingsPanel
          settings={appSettings}
          saving={settingsSaving}
          onSave={saveAppSettings}
        />
      </div>

      {error && (
        <div className="max-w-2xl mx-auto mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      {step === "upload" && (
        <UploadStep
          loading={loading}
          profileSaving={profileSaving}
          profileDirty={profileDirty}
          knowledgeProfile={knowledgeProfile}
          useProfileContext={useProfileContext}
          onProcess={process}
          onProfileChange={updateKnowledgeProfile}
          onSaveProfile={saveKnowledgeProfile}
          onUseProfileContextChange={setUseProfileContext}
        />
      )}

      {step === "answers" && formSchema && (
        <AnswerSheetStep
          formSchema={formSchema}
          mappings={mappings}
          unmappedFields={mappingResult?.unmapped_fields ?? []}
          loading={loading}
          useProfileContext={useProfileContext}
          onUpdate={updateMapping}
          onUseProfileContextChange={setUseProfileContext}
          onRemap={remap}
          onReset={reset}
        />
      )}
    </div>
  );
}
