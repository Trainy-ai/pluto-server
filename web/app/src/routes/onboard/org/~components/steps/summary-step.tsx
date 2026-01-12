"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { FormData } from "../organization-setup-form";

interface SummaryStepProps {
  formData: FormData;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export default function SummaryStep({
  formData,
  onBack,
  onSubmit,
  isSubmitting,
}: SummaryStepProps) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-6 space-y-1.5 sm:mb-8 sm:space-y-2">
        <h2 className="text-lg font-semibold tracking-tight sm:text-2xl">
          Review Your Information
        </h2>
        <p className="text-xs text-muted-foreground sm:text-base">
          Please review your organization details before submitting.
        </p>
      </div>

      <div className="flex-1 space-y-6">
        <div className="space-y-6 rounded-lg border bg-muted/10 p-6">
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="text-xs font-bold text-muted-foreground sm:text-sm">
                Organization Name
              </div>
              <div className="text-sm font-medium break-words sm:text-base">
                {formData.name}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-muted-foreground sm:text-sm">
                Organization URL
              </div>
              <div className="text-sm font-medium break-all sm:text-base">
                <span className="text-muted-foreground">pluto.trainy.ai/o/</span>
                {formData.slug}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto flex justify-between gap-4 pt-4 sm:pt-6">
        <Button
          variant="outline"
          onClick={onBack}
          size="lg"
          className="min-w-[100px] text-sm sm:text-base"
        >
          Back
        </Button>
        <Button
          onClick={onSubmit}
          disabled={isSubmitting}
          size="lg"
          className="min-w-[140px] text-sm sm:text-base"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Organization"
          )}
        </Button>
      </div>
    </div>
  );
}
