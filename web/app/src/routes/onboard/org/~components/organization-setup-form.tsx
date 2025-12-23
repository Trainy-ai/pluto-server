"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import OrganizationDetailsStep from "./steps/organization-details-step";
import SummaryStep from "./steps/summary-step";
import StepIndicator from "./step-indicator";
import { trpc } from "@/utils/trpc";
import { TRPCClientError } from "@trpc/client";

export type FormData = {
  name: string;
  slug: string;
};

const pageVariants = {
  initial: { opacity: 0, x: -20 },
  in: { opacity: 1, x: 0 },
  out: { opacity: 0, x: 20 },
};

const pageTransition = {
  type: "tween",
  ease: "anticipate",
  duration: 0.3,
};

const ONBOARDING_STEPS = [
  {
    title: "Monitor",
    color: "bg-[#FF6B6B]", // Softer red
    offset: "mt-0 ml-0",
    width: "w-[90%]",
  },
  {
    title: "Learn",
    color: "bg-[#4EA8DE]", // Nice blue
    offset: "mt-20 ml-12",
    width: "w-[75%]",
  },
  {
    title: "Get Alerts",
    color: "bg-[#95CD41]", // Fresh green
    offset: "mt-40 ml-6",
    width: "w-[65%]",
  },
  {
    title: "Take Action",
    color: "bg-[#845EC2]", // Rich purple
    offset: "mt-60 ml-6",
    width: "w-[54%]",
  },
  {
    title: "Save $$$",
    color: "bg-[#3ECF8E]", // Fresh green
    offset: "mt-80 ml-6",
    width: "w-[44%]",
  },
];

export default function OrganizationSetupForm() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormData>({
    name: "",
    slug: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mutation = useMutation(trpc.organization.createOrg.mutationOptions());

  const totalSteps = 2;

  const updateFormData = (data: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
  };

  const handleNext = () => {
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      const res = await mutation.mutateAsync(formData);

      toast.success("Organization created successfully!");
      window.location.href = `/o/${res.slug}`;

      setFormData({ name: "", slug: "" });
      setCurrentStep(1);
    } catch (error) {
      if (error instanceof TRPCClientError) {
        toast.error(error.message);
      } else {
        toast.error("Failed to create organization. Please try again.");
      }
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative container mx-auto min-h-screen px-4 py-6 sm:px-6 sm:py-12 lg:px-8">
      <Card className="mx-auto max-w-[1200px] overflow-hidden">
        <CardContent className="flex min-h-[600px] flex-col items-stretch p-0 lg:flex-row">
          {/* Left side - Form */}
          <div className="flex w-full flex-col space-y-8 bg-background p-6 lg:w-1/2 lg:p-8">
            <div className="space-y-3">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
                Lets get you started
              </h1>
              <p className="text-base text-muted-foreground sm:text-lg">
                Create an organization to get started.
              </p>
            </div>

            <div className="flex-1">
              <StepIndicator
                currentStep={currentStep}
                totalSteps={totalSteps}
              />

              <div className="mt-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep}
                    initial="initial"
                    animate="in"
                    exit="out"
                    variants={pageVariants}
                    transition={pageTransition}
                    className="flex min-h-[400px] flex-col"
                  >
                    {currentStep === 1 && (
                      <OrganizationDetailsStep
                        formData={formData}
                        updateFormData={updateFormData}
                        onNext={handleNext}
                      />
                    )}

                    {currentStep === 2 && (
                      <SummaryStep
                        formData={formData}
                        onBack={handleBack}
                        onSubmit={handleSubmit}
                        isSubmitting={isSubmitting}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Right side - Steps (Desktop) */}
          <div className="hidden bg-gray-100 p-8 lg:block lg:w-1/2 dark:bg-[#1f1f1f]">
            <div className="relative h-full">
              {ONBOARDING_STEPS.map((step, index) => (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: index * 0.1,
                    duration: 0.4,
                    ease: [0.4, 0, 0.2, 1],
                  }}
                  className={`absolute right-8 ${step.width} ${step.offset}`}
                >
                  <div
                    className={`${step.color} rounded-2xl px-8 py-5 text-2xl font-semibold text-white shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-xl`}
                  >
                    {step.title}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
