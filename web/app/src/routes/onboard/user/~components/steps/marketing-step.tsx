"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { FormData } from "../user-details-form";

interface MarketingStepProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export default function MarketingStep({
  formData,
  updateFormData,
  onSubmit,
  onBack,
  isSubmitting,
}: MarketingStepProps) {
  const handleCheckboxChange = (checked: boolean) => {
    updateFormData({ allowMarketing: checked });
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-8 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Stay Connected
        </h2>
        <p className="text-base text-muted-foreground">
          Get the latest updates about new features, improvements, and special
          offers
        </p>
      </div>

      <div className="flex-1 space-y-6">
        <div className="items-top flex space-x-3">
          <Checkbox
            id="allowMarketing"
            checked={formData.allowMarketing}
            onCheckedChange={handleCheckboxChange}
            className="mt-1"
          />
          <div className="grid gap-1.5 leading-none">
            <Label
              htmlFor="allowMarketing"
              className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Marketing Communications
            </Label>
            <p className="text-sm text-muted-foreground">
              Yes, I'd like to receive marketing emails and stay updated about
              new features, improvements, and special offers. You can
              unsubscribe at any time.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-auto flex justify-between pt-6">
        <Button
          variant="outline"
          onClick={onBack}
          size="lg"
          className="min-w-[100px]"
          disabled={isSubmitting}
        >
          Back
        </Button>
        <Button
          onClick={onSubmit}
          size="lg"
          className="min-w-[100px]"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Submitting..." : "Submit"}
        </Button>
      </div>
    </div>
  );
}
