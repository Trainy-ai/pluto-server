"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import LocationStep from "./steps/location-step";
import HeardFromStep from "./steps/heard-from-step";
import BackgroundStep from "./steps/background-step";
import MarketingStep from "./steps/marketing-step";
import StepIndicator from "../../org/~components/step-indicator";
import { toast } from "sonner";
import { queryClient, trpc } from "@/utils/trpc";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";

export type FormData = {
  location: string;
  background: string;
  otherBackground: string;
  company: string;
  heardFrom: string;
  otherSource: string;
  allowMarketing: boolean;
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
    title: "Track Experiments",
    color: "bg-[#4EA8DE]", // Nice blue
    offset: "mt-0 ml-0",
    width: "w-[90%]",
  },
  {
    title: "Visualize Results",
    color: "bg-[#95CD41]", // Fresh green
    offset: "mt-20 ml-12",
    width: "w-[75%]",
  },
  {
    title: "Collaborate",
    color: "bg-[#845EC2]", // Rich purple
    offset: "mt-40 ml-6",
    width: "w-[65%]",
  },
  {
    title: "Ship Faster",
    color: "bg-[#FF6B6B]", // Softer red
    offset: "mt-60 ml-6",
    width: "w-[54%]",
  },
];

export default function UserDetailsForm() {
  const navigate = useNavigate();
  const mutation = useMutation(
    trpc.onboarding.finishOnboarding.mutationOptions(),
  );

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    location: "",
    background: "",
    otherBackground: "",
    company: "",
    heardFrom: "",
    otherSource: "",
    allowMarketing: true,
  });

  const totalSteps = 4;

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
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await mutation.mutateAsync({
        location: formData.location,
        background: formData.background || formData.otherBackground,
        company: formData.company,
        howDidYouHearAboutUs: formData.heardFrom || formData.otherSource,
        agreeToMarketing: formData.allowMarketing,
      });

      await queryClient.invalidateQueries();

      // toast.success("Thank you for your submission!");
      navigate({ to: "/o", search: { onboarding: true } });
    } catch (error) {
      toast.error("Failed to submit onboarding details. Please try again.");
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
                Tell us about yourself
              </h1>
              <p className="text-base text-muted-foreground sm:text-lg">
                Help us personalize your experience.
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
                      <LocationStep
                        formData={formData}
                        updateFormData={updateFormData}
                        onNext={handleNext}
                      />
                    )}

                    {currentStep === 2 && (
                      <BackgroundStep
                        formData={formData}
                        updateFormData={updateFormData}
                        onNext={handleNext}
                        onBack={handleBack}
                      />
                    )}

                    {currentStep === 3 && (
                      <HeardFromStep
                        formData={formData}
                        updateFormData={updateFormData}
                        onNext={handleNext}
                        onBack={handleBack}
                      />
                    )}

                    {currentStep === 4 && (
                      <MarketingStep
                        formData={formData}
                        updateFormData={updateFormData}
                        onSubmit={handleSubmit}
                        onBack={handleBack}
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
                  animate={{
                    opacity: currentStep >= index + 1 ? 1 : 0.3,
                    x: 0,
                    scale: currentStep === index + 1 ? 1.01 : 1,
                  }}
                  transition={{
                    duration: 0.4,
                    ease: [0.4, 0, 0.2, 1],
                  }}
                  className={`absolute right-8 ${step.width} ${step.offset}`}
                >
                  <motion.div
                    className={`${step.color} rounded-2xl px-8 py-5 text-2xl font-semibold text-white shadow-lg`}
                    animate={{
                      y: currentStep === index + 1 ? -2 : 0,
                      boxShadow:
                        currentStep === index + 1
                          ? "0 20px 25px -5px rgb(0 0 0 / 0.2)"
                          : "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 20,
                    }}
                  >
                    {step.title}
                  </motion.div>
                </motion.div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
