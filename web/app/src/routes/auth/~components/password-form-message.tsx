import * as React from "react";
import { CircleCheck, XCircleIcon } from "lucide-react";

import { MINIMUM_PASSWORD_LENGTH } from "./~schemas/sign-up";
import { passwordValidator } from "./~schemas/sign-up";
import { useFormField } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export type PasswordFormMessageProps = {
  password: string | null | undefined;
};

export function PasswordFormMessage({
  password,
}: PasswordFormMessageProps): React.JSX.Element {
  const { error, formMessageId } = useFormField();

  const containsLowerAndUpperCase =
    passwordValidator.containsLowerAndUpperCase(password);
  const hasMinimumLength = passwordValidator.hasMinimumLength(password);
  const containsNumber = passwordValidator.containsNumber(password);
  const isPasswordValid =
    containsLowerAndUpperCase && hasMinimumLength && containsNumber;

  const getRequirementToShow = () => {
    if (isPasswordValid) {
      return {
        met: true,
        text: "All requirements met",
      };
    }
    if (!hasMinimumLength) {
      return {
        met: false,
        text: `${MINIMUM_PASSWORD_LENGTH} or more characters`,
      };
    }
    if (!containsLowerAndUpperCase) {
      return {
        met: false,
        text: "Uppercase and lowercase letters",
      };
    }
    return {
      met: false,
      text: "At least one number",
    };
  };

  const requirement = getRequirementToShow();

  return (
    <div
      id={formMessageId}
      className={cn(
        "flex items-center gap-1.5 px-1 text-[0.8rem] font-medium",
        requirement.met
          ? "text-green-500"
          : error
            ? "text-destructive"
            : "text-muted-foreground",
      )}
    >
      {requirement.met ? (
        <CircleCheck className="h-3.5 w-3.5" />
      ) : (
        <XCircleIcon className="h-3.5 w-3.5" />
      )}
      <p>{requirement.text}</p>
    </div>
  );
}
