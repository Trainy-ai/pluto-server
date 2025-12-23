"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormData } from "../user-details-form";
import { toast } from "sonner";

interface LocationStepProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

const locations = [
  { value: "EU", label: "European Union" },
  { value: "US", label: "United States" },
  { value: "Other", label: "Other" },
];

export default function LocationStep({
  formData,
  updateFormData,
  onNext,
}: LocationStepProps) {
  const [error, setError] = useState<string | null>(null);

  const handleLocationChange = (value: string) => {
    updateFormData({ location: value });
    if (error) setError(null);
  };

  const handleNext = () => {
    if (!formData.location) {
      const errorMsg = "Please select a location";
      setError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    onNext();
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-8 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Your Location</h2>
        <p className="text-base text-muted-foreground">
          Please select your primary location to help us provide relevant
          services.
        </p>
      </div>

      <div className="flex-1 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="location"
              className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Location
              <span className="ml-1 text-destructive">*</span>
            </Label>
          </div>
          <Select
            value={formData.location}
            onValueChange={handleLocationChange}
          >
            <SelectTrigger
              id="location"
              className={error ? "border-destructive" : ""}
            >
              <SelectValue placeholder="Select your location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((location) => (
                <SelectItem
                  key={location.value}
                  value={location.value}
                  className="cursor-pointer"
                >
                  {location.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
        </div>
      </div>

      <div className="mt-auto flex justify-end pt-6">
        <Button onClick={handleNext} size="lg" className="min-w-[100px]">
          Next
        </Button>
      </div>
    </div>
  );
}
