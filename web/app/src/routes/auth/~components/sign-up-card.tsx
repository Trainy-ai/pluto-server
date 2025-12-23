/**
 * SignUpCard Component
 *
 * A reusable card component for user registration that supports:
 * - Email/password sign up
 * - OAuth sign up (Google, GitHub)
 * - Remembering recently used authentication methods
 * - Password validation and confirmation
 * - Error handling and loading states
 */

"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  LockIcon,
  MailIcon,
  UserIcon,
  GithubIcon,
  Loader2Icon,
} from "lucide-react";
import { type SubmitHandler } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  type CardProps,
} from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormProvider,
} from "@/components/ui/form";
import { InputPassword } from "./input-password";
import { InputWithAdornments } from "@/components/ui/input-with-adornments";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// import { continueWithGoogle } from "@/actions/auth/continue-with-google";
// import { continueWithMicrosoft } from "@/actions/auth/continue-with-microsoft";
// import { signUp } from "@/actions/auth/sign-up";

import { PasswordFormMessage } from "./password-form-message";
import { useZodForm } from "@/lib/hooks/use-zod-form";
// import GoogleLogo from "~/public/assets/logos/google-logo.svg";
// import MicrosoftLogo from "~/public/assets/logos/microsoft-logo.svg";
import { signUpSchema, type SignUpSchema } from "./~schemas/sign-up";
import { authClient } from "@/lib/auth/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  getRecentAuthMethod,
  setRecentAuthMethod,
} from "@/lib/auth/recent-auth-method";
import { env } from "@/lib/env";

export function SignUpCard({
  className,
  ...other
}: CardProps): React.JSX.Element {
  // State management for error handling and OAuth loading states
  const [errorMessage, setErrorMessage] = React.useState<string>();
  const [oauthLoading, setOAuthLoading] = React.useState<{
    google: boolean;
    github: boolean;
  }>({
    google: false,
    github: false,
  });

  // Form setup with Zod validation
  const methods = useZodForm({
    schema: signUpSchema,
    mode: "onSubmit",
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  // Watch password field for validation
  const password = methods.watch("password");

  // Auth client and query client setup
  const { signUp, signIn } = authClient;
  const queryClient = useQueryClient();

  // Get the most recently used authentication method
  const recentAuthMethod = React.useMemo(() => getRecentAuthMethod(), []);

  /**
   * Handles form submission for email/password sign up
   * - Validates password match
   * - Calls auth service
   * - Handles success/error states
   * - Manages redirects
   */
  const onSubmit: SubmitHandler<SignUpSchema> = async (values) => {
    const { confirmPassword, ...payload } = values;
    if (values.password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }
    setRecentAuthMethod("email");
    const { data, error } = await signUp.email(payload);
    if (error) {
      if (error.message) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("An error occurred during sign up.");
      }
    } else {
      queryClient.invalidateQueries();
      window.location.href = "/o";
    }
  };

  /**
   * Handles Google OAuth sign up
   * - Manages loading state
   * - Calls auth service
   * - Updates recent auth method
   */
  const handleSignInWithGoogle = async (): Promise<void> => {
    if (oauthLoading.google) return;
    setOAuthLoading((prev) => ({ ...prev, google: true }));
    try {
      setRecentAuthMethod("google");
      await signIn.social({
        provider: "google",
      });
    } finally {
      setOAuthLoading((prev) => ({ ...prev, google: false }));
    }
  };

  /**
   * Handles GitHub OAuth sign up
   * - Manages loading state
   * - Calls auth service
   * - Updates recent auth method
   */
  const handleSignInWithGithub = async (): Promise<void> => {
    if (oauthLoading.github) return;
    setOAuthLoading((prev) => ({ ...prev, github: true }));
    try {
      setRecentAuthMethod("github");
      await signIn.social({
        provider: "github",
      });
    } finally {
      setOAuthLoading((prev) => ({ ...prev, github: false }));
    }
  };

  /**
   * Renders OAuth sign up buttons
   * - Sorts buttons to show recently used method first
   * - Adds visual indicators for recently used method
   * - Handles loading states
   * - Provides tooltips for recently used method
   */
  const renderOAuthButtons = () => {
    const buttons = [
      {
        provider: "google",
        label: "Google",
        icon: (
          <img
            src="/assets/logos/google-logo.svg"
            alt="Google"
            className="h-5 w-5"
          />
        ),
        onClick: handleSignInWithGoogle,
        loading: oauthLoading.google,
      },
      {
        provider: "github",
        label: "GitHub",
        icon: (
          <img
            src="/assets/logos/github-logo.svg"
            alt="GitHub"
            className="h-5 w-5 dark:invert"
          />
        ),
        onClick: handleSignInWithGithub,
        loading: oauthLoading.github,
      },
    ];

    // Sort buttons to put recent method first
    if (recentAuthMethod) {
      buttons.sort((a, b) => {
        if (a.provider === recentAuthMethod) return -1;
        if (b.provider === recentAuthMethod) return 1;
        return 0;
      });
    }

    return buttons.map(({ provider, label, icon, onClick, loading }) => {
      const isRecent = provider === recentAuthMethod;

      return (
        <TooltipProvider key={provider}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "flex w-full flex-row items-center gap-2 border-border hover:bg-muted/50",
                  isRecent && "border-primary/50 ring-1 ring-primary/30",
                )}
                disabled={loading}
                onClick={onClick}
              >
                {loading ? (
                  <Loader2Icon className="h-5 w-5 animate-spin" />
                ) : (
                  icon
                )}
                {label}
              </Button>
            </TooltipTrigger>
            {isRecent && (
              <TooltipContent>
                <p>Recently used</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      );
    });
  };

  return (
    <Card
      className={cn(
        "w-full border-transparent px-4 py-2 dark:border-border",
        className,
      )}
      {...other}
    >
      <CardHeader>
        <CardTitle className="text-base lg:text-lg">
          Create your account
        </CardTitle>
        <CardDescription>
          Please fill in the details to get started.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-4">{renderOAuthButtons()}</div>
        {env.VITE_IS_DOCKER && (
          <>
            <p
              className={cn(
                "flex items-center gap-x-3 text-sm text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border",
                className,
              )}
              {...other}
            >
              Or continue with{" "}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "px-0.5 text-foreground",
                        recentAuthMethod === "email" &&
                          "underline decoration-primary/50",
                      )}
                    >
                      email
                    </span>
                  </TooltipTrigger>
                  {recentAuthMethod === "email" && (
                    <TooltipContent>
                      <p>You used this before</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </p>
            <FormProvider {...methods}>
              <form
                className="flex flex-col gap-4"
                onSubmit={methods.handleSubmit(onSubmit)}
              >
                <FormField
                  control={methods.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="flex w-full flex-col">
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <InputWithAdornments
                          type="text"
                          maxLength={64}
                          autoComplete="name"
                          disabled={methods.formState.isSubmitting}
                          startAdornment={
                            <UserIcon className="size-4 shrink-0" />
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={methods.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="flex w-full flex-col">
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <InputWithAdornments
                          type="email"
                          maxLength={255}
                          autoComplete="username"
                          disabled={methods.formState.isSubmitting}
                          startAdornment={
                            <MailIcon className="size-4 shrink-0" />
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex flex-col gap-4">
                  <FormField
                    control={methods.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <InputPassword
                            maxLength={72}
                            autoCapitalize="off"
                            autoComplete="current-password"
                            disabled={methods.formState.isSubmitting}
                            startAdornment={
                              <LockIcon className="size-4 shrink-0" />
                            }
                            {...field}
                          />
                        </FormControl>
                        <PasswordFormMessage password={password} />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={methods.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Confirm Password</FormLabel>
                        <FormControl>
                          <InputPassword
                            maxLength={72}
                            autoCapitalize="off"
                            autoComplete="new-password"
                            disabled={methods.formState.isSubmitting}
                            startAdornment={
                              <LockIcon className="size-4 shrink-0" />
                            }
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {errorMessage && (
                  <Alert variant="destructive">
                    <div className="flex flex-row items-center gap-2 text-sm">
                      <AlertCircleIcon className="size-[18px] shrink-0" />
                      <AlertDescription>{errorMessage}</AlertDescription>
                    </div>
                  </Alert>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={methods.formState.isSubmitting}
                  loading={methods.formState.isSubmitting}
                >
                  Create account
                </Button>
              </form>
            </FormProvider>
          </>
        )}
      </CardContent>
      <CardFooter className="flex justify-center gap-1 text-sm text-muted-foreground">
        <span>Already have an account?</span>
        <Link to="/auth/sign-in" className="text-foreground underline">
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
