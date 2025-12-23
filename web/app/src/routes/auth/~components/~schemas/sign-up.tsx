import { z } from "zod";

export const MINIMUM_PASSWORD_LENGTH = 8;

class PasswordValidator {
  public containsLowerAndUpperCase(str?: string | null): boolean {
    return this.isNotNullOrEmpty(str) && str !== str!.toLowerCase();
  }

  public hasMinimumLength(str?: string | null): boolean {
    return this.isNotNullOrEmpty(str) && str!.length >= MINIMUM_PASSWORD_LENGTH;
  }

  public containsNumber(str?: string | null): boolean {
    return this.isNotNullOrEmpty(str) && /\d/.test(str!);
  }

  public validate(str?: string | null): { success: boolean; errors: string[] } {
    let success = true;
    const errors: string[] = [];

    if (!this.containsLowerAndUpperCase(str)) {
      success = false;
      errors.push(
        "The password should contain lower and upper case characters.",
      );
    }

    if (!this.hasMinimumLength(str)) {
      success = false;
      errors.push(
        `The password should be at least ${MINIMUM_PASSWORD_LENGTH} characters long.`,
      );
    }

    if (!this.containsNumber(str)) {
      success = false;
      errors.push("The password should contain at least one number.");
    }

    return { success, errors };
  }

  private isNotNullOrEmpty(str?: string | null): boolean {
    return !!str;
  }
}

export const passwordValidator = new PasswordValidator();

export const signUpSchema = z.object({
  name: z
    .string({
      required_error: "Name is required.",
      invalid_type_error: "Name must be a string.",
    })
    .trim()
    .min(1, "Name is required.")
    .max(64, "Maximum 64 characters allowed."),
  email: z
    .string({
      required_error: "Email is required.",
      invalid_type_error: "Email must be a string.",
    })
    .trim()
    .min(1, "Email is required.")
    .max(255, "Maximum 255 characters allowed.")
    .email("Enter a valid email address."),
  password: z
    .string({
      required_error: "Password is required.",
      invalid_type_error: "Password must be a string.",
    })
    .min(1, "Password is required.")
    .max(72, "Maximum 72 characters allowed.")
    .refine((arg) => passwordValidator.validate(arg).success, {
      message: "Password does not meet requirements.",
    }),
  confirmPassword: z
    .string({
      required_error: "Confirm password is required.",
      invalid_type_error: "Confirm password must be a string.",
    })
    .min(1, "Confirm password is required.")
    .max(72, "Maximum 72 characters allowed."),
});

export type SignUpSchema = z.infer<typeof signUpSchema>;
