/**
 * SignInCard Component
 *
 * A reusable card component for user authentication that supports:
 * - Email/password sign in
 * - OAuth sign in (Google, GitHub)
 * - Remembering recently used authentication methods
 * - Error handling and loading states
 * - Password recovery link
 */

"use client";

import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  LockIcon,
  MailIcon,
  GithubIcon,
  Loader2Icon,
} from "lucide-react";

// import { AuthErrorCode } from "@workspace/auth/errors";
// import { routes } from "@workspace/routes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth/client";
import { useQueryClient } from "@tanstack/react-query";
import { InputWithAdornments } from "@/components/ui/input-with-adornments";
import { InputPassword } from "./input-password";
// import { continueWithGoogle } from "~/actions/auth/continue-with-google";
// import { continueWithMicrosoft } from "~/actions/auth/continue-with-microsoft";
// import { signInWithCredentials } from "~/actions/auth/sign-in-with-credentials";
import { useZodForm } from "@/lib/hooks/use-zod-form";
// import { authErrorLabels } from "~/lib/labels";

// import GoogleLogo from "~/public/assets/logos/google-logo.svg";
// import MicrosoftLogo from "~/public/assets/logos/microsoft-logo.svg";
import { z } from "zod";
import {
  passThroughCredentialsSchema,
  type PassThroughCredentialsSchema,
} from "./~schemas/sign-in";
import {
  getRecentAuthMethod,
  setRecentAuthMethod,
} from "@/lib/auth/recent-auth-method";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { env } from "@/lib/env";

interface SignInCardProps extends CardProps {
  /** Optional redirect URL after successful sign in */
  redirect?: string;
}

export function SignInCard({
  className,
  redirect,
  ...other
}: SignInCardProps): React.JSX.Element {
  // State management for loading and error handling
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [oauthLoading, setOAuthLoading] = React.useState<{
    google: boolean;
    github: boolean;
  }>({
    google: false,
    github: false,
  });
  const [errorMessage, setErrorMessage] = React.useState<string>();
  const [unverifiedEmail, setUnverifiedEmail] = React.useState<
    string | undefined
  >();

  // Auth client and navigation hooks
  const { signIn } = authClient;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Get the most recently used authentication method
  const recentAuthMethod = React.useMemo(() => getRecentAuthMethod(), []);

  // Form setup with Zod validation
  const methods = useZodForm({
    // We pass through the values and do not validate on the client-side
    // Reason: Would be bad UX to validate fields, unexpected behavior at this spot
    schema: passThroughCredentialsSchema,
    mode: "onSubmit",
    defaultValues: {
      email: "",
      password: "",
    },
  });
  const canSubmit = !isLoading && !methods.formState.isSubmitting;

  /**
   * Handles email/password sign in submission
   * - Validates form data
   * - Calls auth service
   * - Handles success/error states
   * - Manages redirects
   */
  const onSubmit = async (
    values: PassThroughCredentialsSchema,
  ): Promise<void> => {
    if (!canSubmit) {
      return;
    }
    setIsLoading(true);
    setRecentAuthMethod("email");

    const { data, error } = await signIn.email({
      email: values.email,
      password: values.password,
    });

    if (error) {
      // setUnverifiedEmail(
      //   errorCode === AuthErrorCode.UnverifiedEmail ? values.email : undefined,
      // );
      setErrorMessage(error.message);

      setIsLoading(false);
    } else if (data) {
      queryClient.invalidateQueries();

      // refresh the page to route to the dashboard
      if (redirect) {
        window.location.href = redirect;
      } else {
        window.location.reload();
      }

      // setUnverifiedEmail(undefined);
      // setErrorMessage(error.message);
      // setIsLoading(false);
    }
  };

  /**
   * Handles Google OAuth sign in
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
   * Handles GitHub OAuth sign in
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
   * Renders OAuth sign in buttons
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
        <CardTitle className="text-base lg:text-lg">Sign in to</CardTitle>
        <CardDescription>Please sign in to continue.</CardDescription>
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
                  name="email"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <InputWithAdornments
                          {...field}
                          type="email"
                          maxLength={255}
                          autoCapitalize="off"
                          autoComplete="username"
                          startAdornment={
                            <MailIcon className="size-4 shrink-0" />
                          }
                          disabled={methods.formState.isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={methods.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <div className="flex flex-row items-center justify-between">
                        <FormLabel>Password</FormLabel>
                        <Link
                          to="/auth/forgot-password"
                          className="ml-auto inline-block text-sm underline"
                        >
                          Forgot password?
                        </Link>
                      </div>
                      <FormControl>
                        <InputPassword
                          {...field}
                          maxLength={72}
                          autoCapitalize="off"
                          autoComplete="current-password"
                          startAdornment={
                            <LockIcon className="size-4 shrink-0" />
                          }
                          disabled={methods.formState.isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {errorMessage && (
                  <Alert variant="destructive">
                    <div className="flex flex-row items-center gap-2">
                      <AlertCircleIcon className="size-[18px] shrink-0" />
                      <AlertDescription>
                        {errorMessage}
                        {/* {unverifiedEmail && (
                      <Link
                        href={`${routes.dashboard.auth.verifyEmail.Index}?email=${encodeURIComponent(unverifiedEmail)}`}
                        className={cn(
                          buttonVariants({ variant: "link" }),
                          "ml-0.5 h-fit gap-0.5 px-0.5 py-0 text-foreground underline",
                        )}
                      >
                        Verify email
                        <ArrowRightIcon className="size-3 shrink-0" />
                      </Link>
                    )} */}
                      </AlertDescription>
                    </div>
                  </Alert>
                )}
                <Button
                  type="submit"
                  variant="default"
                  className="relative w-full"
                  disabled={!canSubmit}
                  loading={methods.formState.isSubmitting}
                  onClick={methods.handleSubmit(onSubmit)}
                >
                  Sign in
                </Button>
              </form>
            </FormProvider>
          </>
        )}
      </CardContent>
      <CardFooter className="flex justify-center gap-1 text-sm text-muted-foreground">
        <span>Don't have an account?</span>
        <Link to="/auth/sign-up" className="text-foreground underline">
          Sign up
        </Link>
      </CardFooter>
    </Card>
  );
}
