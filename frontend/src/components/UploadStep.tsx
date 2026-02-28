import { useState, useCallback } from "react";
import { FileText, Link, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface UploadStepProps {
  loading: boolean;
  useProfileContext: boolean;
  hasProfileContent: boolean;
  onProcess: (file: File, formUrl: string) => void;
  onUseProfileContextChange: (useProfileContext: boolean) => void;
}

export function UploadStep({
  loading,
  useProfileContext,
  hasProfileContent,
  onProcess,
  onUseProfileContextChange,
}: UploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [formUrl, setFormUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.endsWith(".docx")) {
      setFile(dropped);
    }
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) setFile(selected);
    },
    []
  );

  const isValid =
    file !== null &&
    formUrl.trim().length > 0 &&
    (formUrl.includes("google.com/forms") ||
      formUrl.includes("forms.office.com") ||
      formUrl.includes("forms.microsoft.com"));

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl">Upload & Map</CardTitle>
        <CardDescription>
          Upload a Word document and paste a Google Forms or Microsoft Forms URL
          to generate copy-ready answers for manual form entry.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* File Upload Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById("file-input")?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-blue-500 bg-blue-50"
              : file
              ? "border-green-500 bg-green-50"
              : "border-gray-300 hover:border-gray-400"
          }`}
        >
          <input
            id="file-input"
            type="file"
            accept=".docx"
            onChange={handleFileInput}
            className="hidden"
          />
          {file ? (
            <div className="flex items-center justify-center gap-2 text-green-700">
              <FileText className="h-6 w-6" />
              <span className="font-medium">{file.name}</span>
            </div>
          ) : (
            <div className="text-gray-500">
              <Upload className="h-8 w-8 mx-auto mb-2" />
              <p className="font-medium">
                Drop a .docx file here or click to browse
              </p>
            </div>
          )}
        </div>

        {/* Form URL Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Link className="h-4 w-4" />
            Form URL
          </label>
          <Input
            placeholder="https://docs.google.com/forms/d/e/... or https://forms.office.com/..."
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
          />
        </div>

        {/* Profile context toggle */}
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={useProfileContext}
            onChange={(event) => onUseProfileContextChange(event.target.checked)}
            className="h-4 w-4 mt-0.5"
          />
          <span>
            Use saved profile for mapping
            {!hasProfileContent && " (currently empty)"}
          </span>
        </label>

        {/* Process Button */}
        <Button
          className="w-full"
          size="lg"
          disabled={!isValid || loading}
          onClick={() => file && onProcess(file, formUrl)}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              Processing...
            </span>
          ) : (
            "Process Document & Form"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
