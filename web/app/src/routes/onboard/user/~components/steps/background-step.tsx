"use client";

import type React from "react";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormData } from "../user-details-form";
import { toast } from "sonner";

interface BackgroundStepProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const backgroundOptions = [
  { value: "student", label: "Student" },
  { value: "researcher", label: "Researcher" },
  { value: "cto", label: "CTO" },
  { value: "developer", label: "Developer" },
  { value: "nottoanswer", label: "Prefer not to answer" },
  { value: "other", label: "Other" },
];

export default function BackgroundStep({
  formData,
  updateFormData,
  onNext,
  onBack,
}: BackgroundStepProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [otherBackground, setOtherBackground] = useState(
    formData.background === "other" ? formData.otherBackground : "",
  );

  const clearError = (field: string) => {
    setErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    updateFormData({ [name]: value });
    clearError(name);
  };

  const handleSelectChange = (name: string, value: string) => {
    if (name === "background") {
      updateFormData({
        [name]: value,
        otherBackground: value === "other" ? otherBackground : "",
      });
      clearError(name);
      if (value !== "other") {
        clearError("otherBackground");
      }
    } else {
      updateFormData({ [name]: value });
      clearError(name);
    }
  };

  const handleOtherBackgroundChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value;
    setOtherBackground(value);
    updateFormData({ background: "other", otherBackground: value });
    clearError("otherBackground");
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    // Background validation - only validate if a value is provided
    if (formData.background === "other" && !formData.otherBackground.trim()) {
      newErrors.otherBackground = "Please specify your background";
    }

    // Company validation - only validate if a value is provided
    if (formData.company?.trim() && formData.company.trim().length < 2) {
      newErrors.company = "Company name must be at least 2 characters";
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

  const isFormEmpty = !formData.background && !formData.company?.trim();

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-8 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Your Background
        </h2>
        <p className="text-base text-muted-foreground">
          Tell us a bit about yourself and your professional journey.
        </p>
      </div>

      <div className="flex-1 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="background"
              className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Your background
            </Label>
          </div>
          <Select
            value={formData.background}
            onValueChange={(value) => handleSelectChange("background", value)}
          >
            <SelectTrigger
              id="background"
              className={errors.background ? "border-destructive" : ""}
            >
              <SelectValue placeholder="Select your background (optional)" />
            </SelectTrigger>
            <SelectContent>
              {backgroundOptions.map((option) => (
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
          {formData.background === "other" && (
            <Input
              id="otherBackground"
              name="otherBackground"
              value={otherBackground}
              onChange={handleOtherBackgroundChange}
              placeholder="Please specify your background"
              className={`mt-2 ${errors.otherBackground ? "border-destructive" : ""}`}
            />
          )}
          {errors.background && (
            <p className="text-sm font-medium text-destructive">
              {errors.background}
            </p>
          )}
          {errors.otherBackground && (
            <p className="text-sm font-medium text-destructive">
              {errors.otherBackground}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="company"
              className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Company or Institution
            </Label>
          </div>
          <Input
            id="company"
            name="company"
            value={formData.company}
            onChange={handleInputChange}
            placeholder="Enter your company or institution (optional)"
            className={errors.company ? "border-destructive" : ""}
          />
          {errors.company && (
            <p className="text-sm font-medium text-destructive">
              {errors.company}
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
