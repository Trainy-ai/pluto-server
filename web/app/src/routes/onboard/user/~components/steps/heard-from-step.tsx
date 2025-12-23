"use client";

import type React from "react";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormData } from "../user-details-form";
import { toast } from "sonner";

interface HeardFromStepProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const heardFromOptions = [
  { value: "ycombinator", label: "Y Combinator Network" },
  { value: "search", label: "Search Engine" },
  { value: "social", label: "Social Media" },
  { value: "friend", label: "Friend or Colleague" },
  { value: "conference", label: "AI/ML Conference" },
  { value: "techcrunch", label: "TechCrunch" },
  { value: "hackernews", label: "Hacker News" },
  { value: "github", label: "GitHub" },
  { value: "research", label: "Research Paper/Publication" },
  { value: "podcast", label: "Tech/AI Podcast" },
  { value: "ad", label: "Advertisement" },
  { value: "other", label: "Other" },
];

export default function HeardFromStep({
  formData,
  updateFormData,
  onNext,
  onBack,
}: HeardFromStepProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [otherSource, setOtherSource] = useState(formData.otherSource || "");

  useEffect(() => {
    if (formData.heardFrom !== "other") {
      setOtherSource("");
    }
  }, [formData.heardFrom]);

  const clearError = (field: string) => {
    setErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  };

  const handleSelectChange = (value: string) => {
    updateFormData({ heardFrom: value });
    clearError("heardFrom");
  };

  const handleOtherSourceChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const value = e.target.value;
    setOtherSource(value);
    updateFormData({ otherSource: value });
    clearError("otherSource");
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    // Only validate if "other" is selected
    if (formData.heardFrom === "other" && !formData.otherSource?.trim()) {
      newErrors.otherSource =
        "Please provide more details about how you found us";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateForm()) {
      onNext();
    } else {
      toast.error("Please correct the errors before proceeding");
    }
  };

  const isFormEmpty = !formData.heardFrom && !formData.otherSource?.trim();

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-8 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          How Did You Hear About Us?
        </h2>
        <p className="text-base text-muted-foreground">
          Help us understand how you discovered our platform
        </p>
      </div>

      <div className="flex-1 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="heardFrom"
              className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Source
            </Label>
          </div>
          <Select value={formData.heardFrom} onValueChange={handleSelectChange}>
            <SelectTrigger
              id="heardFrom"
              className={errors.heardFrom ? "border-destructive" : ""}
            >
              <SelectValue placeholder="Select how you found us (optional)" />
            </SelectTrigger>
            <SelectContent>
              {heardFromOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="cursor-pointer"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.heardFrom && (
            <p className="text-sm font-medium text-destructive">
              {errors.heardFrom}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="otherSource"
              className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Additional Details
              {formData.heardFrom === "other" && (
                <span className="ml-1 text-destructive">*</span>
              )}
            </Label>
          </div>
          <Textarea
            id="otherSource"
            value={otherSource}
            onChange={handleOtherSourceChange}
            placeholder={
              formData.heardFrom === "other"
                ? "Please tell us more about how you found us"
                : "Feel free to share more details (optional)"
            }
            className={`min-h-[100px] resize-none ${errors.otherSource ? "border-destructive" : ""}`}
          />
          {errors.otherSource && (
            <p className="text-sm font-medium text-destructive">
              {errors.otherSource}
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={onBack} className="w-[100px]">
          Back
        </Button>
        <Button onClick={handleNext} className="w-[100px]">
          {isFormEmpty ? "Skip" : "Next"}
        </Button>
      </div>
    </div>
  );
}
