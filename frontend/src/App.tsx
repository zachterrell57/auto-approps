import { useFormFiller } from "@/hooks/useFormFiller";
import { UploadStep } from "@/components/UploadStep";
import { AnswerSheetStep } from "@/components/AnswerSheetStep";

export default function App() {
  const {
    step,
    loading,
    error,
    formSchema,
    mappings,
    mappingResult,
    process,
    remap,
    updateMapping,
    reset,
  } = useFormFiller();

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      {error && (
        <div className="max-w-2xl mx-auto mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      {step === "upload" && (
        <UploadStep loading={loading} onProcess={process} />
      )}

      {step === "answers" && formSchema && (
        <AnswerSheetStep
          formSchema={formSchema}
          mappings={mappings}
          unmappedFields={mappingResult?.unmapped_fields ?? []}
          loading={loading}
          onUpdate={updateMapping}
          onRemap={remap}
          onReset={reset}
        />
      )}
    </div>
  );
}
