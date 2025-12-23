"use client";

import type React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { FormData } from "../organization-setup-form";

// Update the schema to allow underscores and modify the regex message
const schema = z.object({
  name: z.string().min(3, "Organization name must be at least 3 characters"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .regex(
      /^[a-z0-9-_]+$/,
      "Slug can only contain lowercase letters, numbers, hyphens, and underscores",
    ),
});

// Add a function to convert name to slug format
const nameToSlug = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special chars except underscores
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/--+/g, "-"); // Replace multiple hyphens with single hyphen
};

interface OrganizationDetailsStepProps {
  formData: FormData;
  updateFormData: (data: Partial<FormData>) => void;
  onNext: () => void;
}

// Update the component to include auto-slug generation
export default function OrganizationDetailsStep({
  formData,
  updateFormData,
  onNext,
}: OrganizationDetailsStepProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [debouncedSlug, setDebouncedSlug] = useState(formData.slug);
  const [isTyping, setIsTyping] = useState(false);
  const [lastCheckedSlug, setLastCheckedSlug] = useState<string | null>(null);

  const { data: slugData, isLoading: slugLoading } = useQuery(
    trpc.onboarding.checkSlugAvailability.queryOptions(
      {
        slug: debouncedSlug,
      },
      {
        enabled: debouncedSlug.length >= 3 && !isTyping,
        staleTime: 30000,
        gcTime: 60000,
        retry: false,
      },
    ),
  );

  const isValidating =
    isTyping || slugLoading || formData.slug !== lastCheckedSlug;
  const canProceed =
    formData.name.trim().length >= 3 &&
    formData.slug &&
    formData.slug.length >= 3 &&
    !isValidating &&
    slugData?.available;

  // Auto-generate slug from name
  useEffect(() => {
    if (
      formData.name &&
      (!formData.slug ||
        formData.slug ===
          nameToSlug(formData.name.substring(0, formData.name.length - 1)))
    ) {
      const newSlug = nameToSlug(formData.name);
      updateFormData({ slug: newSlug });
    }
  }, [formData.name, formData.slug, updateFormData]);

  // Debounce slug for validation with typing indicator
  useEffect(() => {
    if (!formData.slug || formData.slug.length < 3) {
      setDebouncedSlug("");
      setIsTyping(false);
      setLastCheckedSlug(null);
      return;
    }

    setIsTyping(true);
    const typingTimer = setTimeout(() => setIsTyping(false), 500);
    const validationTimer = setTimeout(() => {
      if (formData.slug !== lastCheckedSlug) {
        setDebouncedSlug(formData.slug);
        setLastCheckedSlug(formData.slug);
      }
    }, 800);

    return () => {
      clearTimeout(typingTimer);
      clearTimeout(validationTimer);
    };
  }, [formData.slug, lastCheckedSlug]);

  // Update handleChange to ensure slug is lowercase
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    if (name === "slug") {
      // Ensure slug is lowercase and only contains allowed characters
      const sanitizedValue = value.toLowerCase().replace(/[^a-z0-9-_]/g, "");
      updateFormData({ [name]: sanitizedValue });
      // Clear error when user types
      if (errors[name]) {
        setErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[name];
          return newErrors;
        });
      }
    } else {
      updateFormData({ [name]: value });
      // Clear error when user types
      if (errors[name]) {
        setErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[name];
          return newErrors;
        });
      }
    }
  };

  // Update validateForm to show toast for errors
  const validateForm = () => {
    try {
      schema.parse(formData);

      // Check slug availability
      if (isValidating) {
        toast.error("Please wait while we check slug availability");
        return false;
      }

      if (!canProceed) {
        if (
          formData.slug &&
          formData.slug.length >= 3 &&
          !slugData?.available
        ) {
          const errorMsg = "This slug is already taken";
          setErrors({ slug: errorMsg });
          toast.error(errorMsg);
        } else if (formData.slug && formData.slug.length < 3) {
          const errorMsg = "Slug must be at least 3 characters";
          setErrors({ slug: errorMsg });
          toast.error(errorMsg);
        }
        return false;
      }

      return true;
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);

        // Show toast with the first error message
        if (error.errors.length > 0) {
          toast.error(error.errors[0].message);
        }
      }
      return false;
    }
  };

  // Update handleNext to validate and show toast
  const handleNext = () => {
    if (validateForm()) {
      onNext();
    }
  };

  const getSlugStatus = () => {
    if (!formData.slug) return null;

    if (formData.slug.length < 3) {
      return (
        <div className="flex items-center text-yellow-600">
          <AlertCircle className="mr-2 h-4 w-4" />
          <span className="text-xs font-medium">
            Must be at least 3 characters
          </span>
        </div>
      );
    }

    if (isTyping || formData.slug !== lastCheckedSlug) {
      return (
        <div className="flex items-center text-muted-foreground opacity-70">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span className="text-xs font-medium">Checking availability...</span>
        </div>
      );
    }

    if (slugLoading) {
      return (
        <div className="flex items-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span className="text-xs font-medium">Checking availability...</span>
        </div>
      );
    }

    if (slugData?.available) {
      return (
        <div className="flex items-center text-green-600">
          <Check className="mr-2 h-4 w-4" />
          <span className="text-xs font-medium">Available</span>
        </div>
      );
    }

    return (
      <div className="flex items-center text-red-600">
        <AlertCircle className="mr-2 h-4 w-4" />
        <span className="text-xs font-medium">Already taken</span>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="space-y-4">
          <div>
            <Label htmlFor="name" className="text-sm font-medium">
              Organization Name
            </Label>
            <p className="mt-1.5 text-sm text-muted-foreground">
              The name of your organization as it will appear in the
              application.
            </p>
          </div>
          <Input
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="mlop Inc."
            className={`h-11 text-base placeholder:text-muted-foreground/50 ${
              errors.name ? "border-destructive" : ""
            }`}
          />
          {errors.name && (
            <p className="text-xs font-medium text-destructive">
              {errors.name}
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="slug" className="text-sm font-medium">
              Organization URL
            </Label>
            <p className="mt-1.5 text-sm text-muted-foreground">
              This will be your unique URL for accessing the organization.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <div className="flex h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground/80">
              trakkur.trainy.ai/o/
            </div>
            <Input
              id="slug"
              name="slug"
              value={formData.slug}
              onChange={handleChange}
              placeholder="mlop"
              className={`h-11 flex-1 text-base font-medium transition-colors placeholder:text-muted-foreground/50 focus:bg-black/10 ${
                errors.slug ? "border-destructive" : ""
              }`}
            />
          </div>
          {errors.slug ? (
            <p className="text-xs font-medium text-destructive">
              {errors.slug}
            </p>
          ) : (
            getSlugStatus()
          )}
        </div>
      </div>

      <Button
        onClick={handleNext}
        disabled={!canProceed}
        size="lg"
        className="h-11 w-full text-sm font-medium"
      >
        Next
      </Button>
    </div>
  );
}
